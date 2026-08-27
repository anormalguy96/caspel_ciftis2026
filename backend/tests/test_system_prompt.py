"""The system prompt is the only thing standing between a grounded answer and
an invented one.

It carries no type checking, no schema and no runtime error when a clause goes
missing -- a deleted line simply produces a confident, plausible answer with a
citation to a page that does not exist, at an exhibition stand, to a visitor
who has no way to tell. These tests assert each required behaviour
independently rather than pinning the prompt byte-for-byte, so the wording can
be improved without a test rewrite while the guarantees stay.
"""

import re

from app.rag.generation import SYSTEM_PROMPT


def _normalise(text: str) -> str:
    """Collapse whitespace so assertions survive re-wrapping."""
    return re.sub(r"\s+", " ", text).strip().lower()


PROMPT = _normalise(SYSTEM_PROMPT)


# ---------------------------------------------------------------- language

def test_requires_professional_english_output():
    assert "respond in 100% fluent, professional english" in PROMPT


def test_translates_azerbaijani_source_material_into_english():
    assert "source material translation" in PROMPT
    assert "azerbaijani" in PROMPT
    # A worked example is what stops the model emitting "Layihə / Project".
    assert "layihə" in PROMPT and "project" in PROMPT
    assert "never include raw azerbaijani words" in PROMPT


def test_understands_a_question_asked_in_azerbaijani():
    assert "visitor questions" in PROMPT
    assert "may ask their question in azerbaijani" in PROMPT
    assert "answer in professional english" in PROMPT


# ---------------------------------------------------------------- grounding

def test_answers_only_from_supplied_context():
    assert "using only the approved context provided below" in PROMPT


def test_forbids_invention_of_the_facts_that_matter():
    assert "do not invent, hallucinate, or assume" in PROMPT
    for forbidden in (
        "client names",
        "pricing or financial figures",
        "unverified partnerships or certifications",
        "technical capabilities or features not mentioned",
        "office addresses or corporate statistics not in the context",
    ):
        assert forbidden in PROMPT, f"missing no-invention clause: {forbidden}"


def test_refuses_politely_when_the_context_does_not_answer():
    assert "if the answer cannot be found in the provided context" in PROMPT
    assert "not available in our official exhibition materials" in PROMPT
    # The refusal has to leave the visitor somewhere to go.
    assert "request a demo or speak with our representatives" in PROMPT


# ---------------------------------------------------------------- citations

def test_requires_the_document_and_page_citation_format():
    assert "cite the presentation name and page number" in PROMPT
    assert "[caspel erp presentation, page 4]" in PROMPT


def test_forbids_a_citation_that_is_not_in_the_context():
    assert "never cite a document, presentation or page number that does not appear" in PROMPT


# ---------------------------------------------------------------- formatting

def test_requests_restrained_markdown_the_client_can_render():
    assert "markdown" in PROMPT
    assert "**term**" in PROMPT
    assert "numbered lists" in PROMPT and "bulleted lists" in PROMPT
    # The exhibition client parses bold, lists, headings and inline code only.
    # Anything else reaches the visitor as raw punctuation.
    assert "do not use markdown tables, italics or fenced code blocks" in PROMPT


def test_prompt_carries_no_credential_or_endpoint():
    """The prompt travels to a third-party provider on every request."""
    assert "aiza" not in PROMPT
    assert "api_key" not in PROMPT and "api key" not in PROMPT
    assert "postgres" not in PROMPT
    assert not re.search(r"https?://", PROMPT)
