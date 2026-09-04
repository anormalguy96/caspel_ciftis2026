"""Grouped citation markers must not leave punctuation debris.

The system prompt asks for one identifier per bracket pair. The model writes
groups anyway: "[SOURCE_1, SOURCE_2, SOURCE_3]". Removing each identifier and
then only tidying "[ ]" left a visitor reading

    ...into a single ecosystem and database [,, ]. It replaces...

on the default, non-streaming path. It was found by asking the running
application a real question, which is also why these cases are written as whole
sentences rather than as bare markers.

Both delivery arms are asserted together. An answer must not read differently
depending on how it was delivered, and the two arms strip markers with
different code, so parity has to be tested rather than assumed.
"""
from __future__ import annotations

import pytest

from app.rag.citations import strip_citation_markers
from app.rag.streaming import CitationStreamFilter


def _streamed(text: str) -> str:
    """Push text through the streaming filter as a single chunk."""
    filt = CitationStreamFilter()
    return (filt.feed(text) + filt.flush()).strip()


#: (input, expected). Each is a form the model has produced or plausibly will.
CASES = [
    pytest.param(
        "It integrates operations into a single ecosystem and database "
        "[SOURCE_1, SOURCE_2, SOURCE_3]. It replaces fragmented tools.",
        "It integrates operations into a single ecosystem and database. "
        "It replaces fragmented tools.",
        id="three-in-one-bracket-observed-in-production",
    ),
    pytest.param(
        "Caspel ERP covers procurement [SOURCE_1; SOURCE_2].",
        "Caspel ERP covers procurement.",
        id="semicolon-separated",
    ),
    pytest.param(
        "Two sources agree [SOURCE_1,SOURCE_2] on this.",
        "Two sources agree on this.",
        id="no-space-after-comma",
    ),
    pytest.param(
        "It has 12 modules [SOURCE_2].",
        "It has 12 modules.",
        id="single-marker-still-works",
    ),
    pytest.param(
        "解决方案包括端点保护 [SOURCE_1, SOURCE_2]。",
        "解决方案包括端点保护。",
        id="chinese-full-width-stop",
    ),
    pytest.param(
        "网络安全服务 [SOURCE_1、SOURCE_2] 覆盖检测。",
        "网络安全服务 覆盖检测。",
        id="chinese-ideographic-comma-inside-group",
    ),
    pytest.param(
        "The platform is modular (SOURCE_1) and extensible.",
        "The platform is modular and extensible.",
        id="round-brackets",
    ),
]


@pytest.mark.parametrize("text,expected", CASES)
def test_non_streaming_leaves_no_debris(text: str, expected: str) -> None:
    assert strip_citation_markers(text) == expected


@pytest.mark.parametrize("text,expected", CASES)
def test_streaming_leaves_no_debris(text: str, expected: str) -> None:
    assert _streamed(text) == expected


@pytest.mark.parametrize("text,expected", CASES)
def test_both_arms_agree(text: str, expected: str) -> None:
    """The same answer, delivered two ways, must read the same."""
    assert strip_citation_markers(text) == _streamed(text)


@pytest.mark.parametrize(
    "text",
    [
        "a single ecosystem and database [SOURCE_1, SOURCE_2, SOURCE_3].",
        "procurement [SOURCE_1; SOURCE_2] and logistics.",
        "解决方案 [SOURCE_1, SOURCE_2]。",
    ],
)
def test_no_stranded_bracket_reaches_a_visitor(text: str) -> None:
    for rendered in (strip_citation_markers(text), _streamed(text)):
        assert "[" not in rendered
        assert "]" not in rendered
        # The debris that shipped: a bracket holding only separators.
        assert ",," not in rendered
        assert not rendered.startswith(",")


def test_prose_inside_a_bracket_is_not_deleted() -> None:
    """A form the prompt never asks for must not cost the visitor real words.

    "[SOURCE_1 and SOURCE_2]" is not a citation group this system produces, and
    the safe response is to leave the prose alone rather than guess which words
    were plumbing. Both arms must make the same choice.
    """
    text = "Mixed form [SOURCE_1 and SOURCE_2] here."
    assert "and" in strip_citation_markers(text)
    assert strip_citation_markers(text) == _streamed(text)


def test_a_group_split_across_chunks_is_still_removed() -> None:
    """The stream sees "[SOURCE_1, SOU" then "RCE_2] covers this"."""
    filt = CitationStreamFilter()
    out = filt.feed("Procurement [SOURCE_1, SOU")
    out += filt.feed("RCE_2] is covered.")
    out += filt.flush()
    assert out.strip() == "Procurement is covered."
    assert "SOURCE" not in out
