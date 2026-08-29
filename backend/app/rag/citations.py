"""Server-owned citation identifiers for grounded answers.

A model asked to cite its sources will happily produce a citation that looks
correct and is not: the right document with the wrong page, or a plausible
filename that was never retrieved. At an exhibition that is worse than no
citation, because a visitor can walk to the stand and ask to see page 12 of a
deck whose page 12 says something else.

So the model never authors citation metadata. Each retrieved record is given an
opaque identifier, the model may reference only those identifiers, and every
identifier it returns is validated against the records that were actually
retrieved. Document titles and page numbers are then filled in from the server's
own copy. An identifier the model invents resolves to nothing and is removed.

This is the same reasoning as OWASP LLM01: text coming back from a model is
untrusted input, including the parts that look structural.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

#: SOURCE_1, SOURCE_2 … Matched case-insensitively and tolerant of the bracket
#: styles a model tends to produce ("[SOURCE_2]", "(source_2)").
CITATION_PATTERN = re.compile(r"\bSOURCE[_\s-]?(\d{1,3})\b", re.IGNORECASE)

#: Guards against a pathological answer that is nothing but citation markers.
MAX_CITATIONS = 16


@dataclass(frozen=True)
class SourceRecord:
    """One retrieved chunk, as the server knows it. Immutable on purpose."""

    identifier: str
    document: str
    page: int
    product: Optional[str]
    score: Optional[float]
    content: str


def build_source_records(chunks: Sequence[object]) -> List[SourceRecord]:
    """Assign a stable identifier to each retrieved chunk.

    Identifiers are positional and per-request. They are meaningless outside
    the single generation call they were built for, which is what stops a model
    from "remembering" a citation across turns.
    """
    records: List[SourceRecord] = []
    for index, chunk in enumerate(chunks, start=1):
        records.append(
            SourceRecord(
                identifier=f"SOURCE_{index}",
                document=getattr(chunk, "document_name", ""),
                page=int(getattr(chunk, "page_number", 0) or 0),
                product=getattr(chunk, "product", None),
                score=getattr(chunk, "score", None),
                content=getattr(chunk, "content", "") or "",
            )
        )
    return records


def format_context(records: Iterable[SourceRecord]) -> str:
    """Render the retrieved records as delimited, labelled blocks.

    The delimiters matter. Retrieved text is untrusted -- a PDF could contain
    "ignore previous instructions" -- so each record is fenced and explicitly
    labelled as reference material rather than pasted into the prompt as if the
    author were speaking to the model.
    """
    blocks = []
    for record in records:
        blocks.append(
            f"<source id=\"{record.identifier}\">\n"
            f"document: {record.document}\n"
            f"page: {record.page}\n"
            "content:\n"
            f"{record.content}\n"
            "</source>"
        )
    return "\n\n".join(blocks)


def extract_citations(answer: str) -> List[str]:
    """Every SOURCE_n identifier the model referenced, in order, de-duplicated."""
    seen: set[str] = set()
    found: List[str] = []
    for match in CITATION_PATTERN.finditer(answer or ""):
        identifier = f"SOURCE_{int(match.group(1))}"
        if identifier not in seen:
            seen.add(identifier)
            found.append(identifier)
        if len(found) >= MAX_CITATIONS:
            break
    return found


def strip_citation_markers(answer: str) -> str:
    """Remove the machine identifiers from visitor-facing prose.

    The markers are plumbing. A visitor should see a clean answer and a
    Sources list, not "[SOURCE_2]" mid-sentence.
    """
    cleaned = CITATION_PATTERN.sub("", answer or "")
    # Tidy the punctuation the removal leaves behind: "( )", "[]", doubled
    # spaces, and a space before a full stop.
    cleaned = re.sub(r"[\[(]\s*[\])]", "", cleaned)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def resolve_citations(
    answer: str,
    records: Sequence[SourceRecord],
) -> Tuple[str, List[SourceRecord], List[str]]:
    """Validate the model's citations against what was actually retrieved.

    Returns the cleaned answer, the resolved server-owned records in the order
    the model cited them, and any identifiers that matched nothing.

    An unknown identifier is dropped, never rendered and never guessed at. It
    is reported separately so the caller can log that it happened without
    putting a fabricated citation in front of a visitor.
    """
    by_id = {record.identifier: record for record in records}

    resolved: List[SourceRecord] = []
    unknown: List[str] = []

    for identifier in extract_citations(answer):
        record = by_id.get(identifier)
        if record is None:
            unknown.append(identifier)
        else:
            resolved.append(record)

    return strip_citation_markers(answer), resolved, unknown
