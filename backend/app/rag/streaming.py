"""Server-sent streaming for grounded answers.

The non-streaming endpoint stays exactly as it is and remains the default. This
is an additional path behind a server-owned flag, because streaming changes the
failure modes: a request that has already emitted half an answer cannot simply
become a 503.

Two problems dominate the implementation.

**Citation markers must never reach the visitor.** The model writes
``[SOURCE_1]`` inline as it generates, and a marker can be split across
provider chunks -- ``[SOU`` in one and ``RCE_1]`` in the next. Emitting text
naively shows raw markers; emitting only whole chunks stalls the stream. The
filter below holds back the shortest tail that could still become a marker and
releases everything else immediately.

**A failure after the first token is not a 503.** Once text has been sent the
HTTP status is already 200. A mid-stream failure is reported as an explicit
``error`` event and the client must not present the partial text as a finished
answer.

Citations are resolved and validated *after* generation completes, against the
records that were actually retrieved, and sent as their own event. Nothing the
model invents is ever emitted.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import AsyncIterator, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

#: One identifier, as tolerantly as citations.CITATION_PATTERN reads it.
_ID = r"SOURCE[_\s-]?\d{1,3}"

#: A complete inline citation, in every form the model actually produces.
#:
#: The system prompt asks for "[SOURCE_1]", and a first end-to-end run through
#: nginx showed the model also writing "[SOURCE_1, SOURCE_2]" -- several
#: identifiers inside one bracket pair. A pattern that only matched the single
#: form let that reach the visitor verbatim, which is exactly what this filter
#: exists to prevent. Bare identifiers outside brackets are caught too, since
#: the resolver accepts them.
_MARKER = re.compile(
    rf"\[\s*{_ID}(?:\s*[,;]\s*{_ID})*\s*\]|{_ID}",
    re.IGNORECASE,
)

#: Punctuation repair after a marker is removed, mirroring
#: citations.strip_citation_markers so both delivery paths render alike.
_EMPTY_BRACKETS = re.compile(r"[\[(]\s*[\])]")
_SPACE_BEFORE_PUNCT = re.compile(r"[ \t]+([,.;:!?。，、！？：；])")
_DOUBLE_SPACE = re.compile(r"[ \t]{2,}")
_TRAILING_SPACES = re.compile(r"[ \t]+$")

#: How much text may be withheld while a marker is still arriving. A grouped
#: citation is longer than a single one, so the bound is generous enough for a
#: realistic group and still small enough that the stream never visibly stalls.
_MAX_HELD = 72

#: A tail that could still grow into a marker. Either an open bracket whose
#: contents so far are consistent with a citation group, or a partially typed
#: bare identifier.
_PARTIAL = re.compile(
    rf"\[[^\]\[]{{0,{_MAX_HELD}}}$"
    r"|(?:S|SO|SOU|SOUR|SOURC|SOURCE|SOURCE[_\s-]|SOURCE[_\s-]\d{1,2})$",
    re.IGNORECASE,
)


class CitationStreamFilter:
    """Strips citation markers from a token stream without stalling it.

    Text is released as soon as it is provably not part of a marker. Only a
    short tail is ever withheld, so the visitor sees a steady stream rather
    than the burst-and-pause an unbounded buffer would produce.

    The unfiltered text is retained separately: citation resolution needs the
    markers the filter removed.
    """

    def __init__(self) -> None:
        self._pending = ""
        self._raw_parts: List[str] = []

    def feed(self, chunk: str) -> str:
        """Absorb a provider chunk; return the text that is safe to emit now."""
        if not chunk:
            return ""
        self._raw_parts.append(chunk)
        self._pending += chunk

        # Remove every complete marker first.
        cleaned = _MARKER.sub("", self._pending)

        # Whatever trails that could still become a marker stays behind.
        match = _PARTIAL.search(cleaned)
        if match:
            hold = cleaned[match.start():]
            # A pathological run of '[' must not grow without bound.
            if len(hold) > _MAX_HELD:
                self._pending = ""
                return self._tidy(cleaned)
            self._pending = hold
            return self._tidy(cleaned[: match.start()])

        self._pending = ""
        return self._tidy(cleaned)

    def _tidy(self, text: str) -> str:
        """Repair the punctuation a removed marker leaves behind.

        The non-streaming path already does this, and an answer must not read
        differently depending on how it was delivered -- "experience ." in one
        arm and "experience." in the other is the same answer rendered two
        ways.

        A trailing run of spaces is withheld rather than emitted, because the
        punctuation that decides whether it should survive may be in the next
        chunk. It is only ever a space or two, so nothing visibly stalls.
        """
        if not text:
            return ""

        text = _EMPTY_BRACKETS.sub("", text)
        text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
        text = _DOUBLE_SPACE.sub(" ", text)

        trailing = _TRAILING_SPACES.search(text)
        if trailing:
            self._pending = text[trailing.start():] + self._pending
            text = text[: trailing.start()]
        return text

    def flush(self) -> str:
        """Release anything still held once generation has finished."""
        remaining = _MARKER.sub("", self._pending)
        self._pending = ""
        return remaining

    @property
    def raw_text(self) -> str:
        """Everything the model produced, markers included."""
        return "".join(self._raw_parts)


@dataclass(frozen=True)
class StreamEvent:
    """One server-sent event."""

    event: str
    data: dict

    def encode(self) -> str:
        """Serialise as SSE.

        The payload is JSON, which handles newlines and non-ASCII text without
        any escaping of our own -- a Chinese answer containing a line break
        would otherwise corrupt the frame, because SSE treats a bare newline as
        a field separator.
        """
        payload = json.dumps(self.data, ensure_ascii=False)
        return f"event: {self.event}\ndata: {payload}\n\n"


def sse_comment(text: str = "") -> str:
    """A heartbeat. Comments keep an idle connection alive and are ignored."""
    return f": {text}\n\n"


async def stream_answer(
    *,
    generate_chunks: Iterable[str],
    records: Sequence[object],
    resolve,
    build_sources,
    heartbeat_every: int = 0,
) -> AsyncIterator[str]:
    """Turn a provider token stream into validated SSE frames.

    ``generate_chunks`` yields text. ``resolve`` validates citations against
    ``records`` once generation is complete, and ``build_sources`` turns the
    resolved records into the public source objects.

    Order is fixed and meaningful: ``meta`` before any text so the client can
    render its frame, ``delta`` repeatedly, then ``citations`` only after
    validation, then ``done``. A client that stops at ``done`` without seeing
    ``citations`` has an answer with no sources, which is honest; a client that
    never sees ``done`` must treat the answer as incomplete.
    """
    filt = CitationStreamFilter()
    emitted_any = False

    yield StreamEvent("meta", {"grounded": bool(records)}).encode()

    try:
        sent_since_beat = 0
        for chunk in generate_chunks:
            text = filt.feed(chunk)
            if text:
                emitted_any = True
                yield StreamEvent("delta", {"text": text}).encode()
            sent_since_beat += 1
            if heartbeat_every and sent_since_beat >= heartbeat_every:
                sent_since_beat = 0
                yield sse_comment("keep-alive")

        tail = filt.flush()
        if tail:
            emitted_any = True
            yield StreamEvent("delta", {"text": tail}).encode()

    except Exception as exc:  # noqa: BLE001
        # Type only. A provider exception can carry the prompt or configuration.
        logger.error("Streaming generation failed: %s", type(exc).__name__)
        yield StreamEvent(
            "error",
            {
                "recoverable": not emitted_any,
                # The client decides what to show; it is never given provider text.
                "reason": "generation_failed",
            },
        ).encode()
        return

    # Citations are resolved only now, against what was actually retrieved.
    # Anything the model invented resolves to nothing and is dropped.
    try:
        _, cited, unknown = resolve(filt.raw_text, records)
        if unknown:
            logger.warning(
                "Rejected %d unresolvable citation identifier(s) from the model",
                len(unknown),
            )
        sources = build_sources(cited)
    except Exception as exc:  # noqa: BLE001
        logger.error("Citation resolution failed: %s", type(exc).__name__)
        sources = []

    yield StreamEvent(
        "citations",
        {"sources": [s.model_dump() if hasattr(s, "model_dump") else s for s in sources]},
    ).encode()
    yield StreamEvent("done", {"complete": True}).encode()
