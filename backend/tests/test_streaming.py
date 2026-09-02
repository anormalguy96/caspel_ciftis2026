"""Streaming: marker filtering, fragmented boundaries, UTF-8 and failure honesty."""
import json

import pytest

from app.rag.streaming import (
    CitationStreamFilter,
    StreamEvent,
    sse_comment,
    stream_answer,
)


def _drain(filt: CitationStreamFilter, chunks):
    out = "".join(filt.feed(c) for c in chunks)
    return out + filt.flush()


# ==========================================================================
# Marker filtering
# ==========================================================================

def test_a_whole_marker_is_removed():
    filt = CitationStreamFilter()
    assert _drain(filt, ["CASPEL has 20 years [SOURCE_1] of experience."]) == (
        "CASPEL has 20 years  of experience."
    )


def test_marker_split_across_two_chunks_is_still_removed():
    # The provider decides where chunks break; a marker can land across one.
    filt = CitationStreamFilter()
    assert "[SOURCE" not in _drain(filt, ["Answer text [SOU", "RCE_1] continues."])


def test_marker_split_character_by_character_is_still_removed():
    filt = CitationStreamFilter()
    chunks = list("Grounded [SOURCE_12] answer.")
    assert "SOURCE" not in _drain(filt, chunks)


def test_multiple_markers_are_all_removed():
    filt = CitationStreamFilter()
    out = _drain(filt, ["A [SOURCE_1] B [SOURCE_2] C [SOURCE_10] D"])
    assert "SOURCE" not in out
    assert "A" in out and "D" in out


def test_text_is_released_promptly_rather_than_buffered_to_the_end():
    # A filter that waits for completion would stall the stream.
    filt = CitationStreamFilter()
    first = filt.feed("This is a long sentence with no marker in it at all.")
    assert first == "This is a long sentence with no marker in it at all."


def test_only_a_short_tail_is_ever_withheld():
    filt = CitationStreamFilter()
    filt.feed("Some text [SOU")
    # The held-back portion is the partial marker, nothing more.
    assert len(filt._pending) <= 16


def test_a_lone_bracket_is_not_swallowed_forever():
    filt = CitationStreamFilter()
    out = _drain(filt, ["Cost is [", "approximately] ten."])
    assert "approximately" in out


def test_a_pathological_bracket_run_does_not_grow_without_bound():
    filt = CitationStreamFilter()
    filt.feed("[" * 200)
    assert len(filt._pending) <= 16


def test_raw_text_keeps_the_markers_for_resolution():
    filt = CitationStreamFilter()
    _drain(filt, ["A [SOURCE_1] B"])
    # Citation resolution needs what the filter removed.
    assert "[SOURCE_1]" in filt.raw_text


def test_text_with_no_markers_survives_byte_for_byte():
    filt = CitationStreamFilter()
    original = "Caspel ERP covers CRM, procurement, finance and HR."
    assert _drain(filt, [original]) == original


# ==========================================================================
# UTF-8 and multiline
# ==========================================================================

def test_chinese_text_streams_intact():
    filt = CitationStreamFilter()
    text = "CASPEL 提供网络安全服务，包括端点保护。"
    assert _drain(filt, [text]) == text


def test_chinese_text_with_a_marker_keeps_every_character():
    filt = CitationStreamFilter()
    out = _drain(filt, ["CASPEL 提供网络安全服务 [SOURCE_3] 包括端点保护。"])
    assert "SOURCE" not in out
    assert "网络安全服务" in out
    assert "包括端点保护" in out


def test_azerbaijani_diacritics_survive():
    filt = CitationStreamFilter()
    text = "Satınalma və mal sifarişi idarə olunur."
    assert _drain(filt, [text]) == text


def test_sse_payload_json_encodes_newlines_and_unicode():
    frame = StreamEvent("delta", {"text": "第一行\n第二行"}).encode()
    assert frame.startswith("event: delta\n")
    assert frame.endswith("\n\n")
    # Exactly one data line: a raw newline would split the SSE frame.
    data_lines = [l for l in frame.split("\n") if l.startswith("data: ")]
    assert len(data_lines) == 1
    assert json.loads(data_lines[0][6:])["text"] == "第一行\n第二行"


def test_heartbeat_is_an_ignorable_comment():
    assert sse_comment("keep-alive").startswith(":")
    assert sse_comment().endswith("\n\n")


# ==========================================================================
# Event sequence
# ==========================================================================

class _Rec:
    def __init__(self, identifier, page):
        self.identifier = identifier
        self.page = page
        self.document = "CASPEL Corporate Presentation"
        self.product = "caspel"


def _resolve_ok(raw, records):
    return raw, list(records), []


def _resolve_with_unknown(raw, records):
    return raw, list(records), ["SOURCE_99"]


def _build_sources(cited):
    return [{"document": r.document, "page": r.page, "slug": r.product} for r in cited]


async def _collect(gen):
    return [frame async for frame in gen]


def _events(frames):
    out = []
    for f in frames:
        if f.startswith(":"):
            out.append(("comment", None))
            continue
        lines = f.strip().split("\n")
        name = lines[0].removeprefix("event: ")
        payload = json.loads(lines[1].removeprefix("data: "))
        out.append((name, payload))
    return out


@pytest.mark.asyncio
async def test_event_order_is_meta_deltas_citations_done():
    frames = await _collect(
        stream_answer(
            generate_chunks=["Hello ", "world [SOURCE_1]."],
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    names = [n for n, _ in _events(frames)]
    assert names[0] == "meta"
    assert names[-1] == "done"
    assert "citations" in names
    assert names.index("citations") < names.index("done")
    assert all(n != "citations" for n in names[: names.index("citations")] if n == "citations")


@pytest.mark.asyncio
async def test_citations_arrive_only_after_the_text():
    frames = await _collect(
        stream_answer(
            generate_chunks=["Grounded answer [SOURCE_1]."],
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    events = _events(frames)
    last_delta = max(i for i, (n, _) in enumerate(events) if n == "delta")
    citations = next(i for i, (n, _) in enumerate(events) if n == "citations")
    assert citations > last_delta


@pytest.mark.asyncio
async def test_no_unresolved_marker_reaches_any_delta():
    frames = await _collect(
        stream_answer(
            generate_chunks=["A [SOURCE_1] B [SOU", "RCE_2] C"],
            records=[_Rec("SOURCE_1", 7), _Rec("SOURCE_2", 8)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    for name, payload in _events(frames):
        if name == "delta":
            assert "SOURCE" not in payload["text"]


@pytest.mark.asyncio
async def test_an_invented_identifier_is_dropped_not_emitted():
    frames = await _collect(
        stream_answer(
            generate_chunks=["Answer [SOURCE_99]."],
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_with_unknown,
            build_sources=_build_sources,
        )
    )
    events = dict(_events(frames))
    assert all(s["page"] == 7 for s in events["citations"]["sources"])


@pytest.mark.asyncio
async def test_a_mid_stream_failure_is_reported_and_never_completed():
    def failing():
        yield "Partial answer that "
        raise RuntimeError("provider died")

    frames = await _collect(
        stream_answer(
            generate_chunks=failing(),
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    names = [n for n, _ in _events(frames)]
    assert "error" in names
    # A partial answer must never be dressed up as a finished one.
    assert "done" not in names
    assert "citations" not in names


@pytest.mark.asyncio
async def test_a_failure_before_any_text_is_marked_recoverable():
    def failing():
        raise RuntimeError("provider died")
        yield ""  # pragma: no cover

    frames = await _collect(
        stream_answer(
            generate_chunks=failing(),
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    error = dict(_events(frames))["error"]
    # Nothing was shown yet, so the client may fall back to the plain endpoint.
    assert error["recoverable"] is True


@pytest.mark.asyncio
async def test_a_failure_after_text_is_not_recoverable_by_retry():
    def failing():
        yield "Half an answer"
        raise RuntimeError("provider died")

    frames = await _collect(
        stream_answer(
            generate_chunks=failing(),
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    assert dict(_events(frames))["error"]["recoverable"] is False


@pytest.mark.asyncio
async def test_no_provider_text_appears_in_an_error_event():
    def failing():
        raise RuntimeError("zzPROVIDERSECRETzz")
        yield ""  # pragma: no cover

    frames = await _collect(
        stream_answer(
            generate_chunks=failing(),
            records=[],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    assert "zzPROVIDERSECRETzz" not in "".join(frames)


@pytest.mark.asyncio
async def test_meta_reports_whether_the_answer_is_grounded():
    frames = await _collect(
        stream_answer(
            generate_chunks=["No context available."],
            records=[],
            resolve=_resolve_ok,
            build_sources=_build_sources,
        )
    )
    assert dict(_events(frames))["meta"]["grounded"] is False


@pytest.mark.asyncio
async def test_heartbeats_are_emitted_when_configured():
    frames = await _collect(
        stream_answer(
            generate_chunks=["a", "b", "c", "d"],
            records=[_Rec("SOURCE_1", 7)],
            resolve=_resolve_ok,
            build_sources=_build_sources,
            heartbeat_every=2,
        )
    )
    assert any(f.startswith(":") for f in frames)
