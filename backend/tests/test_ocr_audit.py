"""The OCR audit heuristic must not cry wolf.

The first version of this heuristic treated isolated one- and two-letter
capitals as evidence of corruption. On an Azerbaijani deck that fires on
ordinary text, so it flagged 39 of 65 pages while retrieval scored Recall@4
100% on the very cases those pages answer. These tests exist so that failure
mode cannot come back: legitimate Azerbaijani, Chinese and product terminology
must stay clean, and only signals that cannot be legitimate text may flag.
"""
from __future__ import annotations

import pytest

from scripts.audit_ocr import audit_page


# ---------------------------------------------------------------------------
# Must NOT flag: real text from the indexed corpus
# ---------------------------------------------------------------------------

CLEAN = [
    pytest.param(
        "Data Solutions\nSovereign Data Infrastructure\n \n"
        "Business Intelligence & Analytics\n \nData Integration",
        18,
        id="english-slide",
    ),
    pytest.param(
        "Maliyyə və mühasibatlıq\nƏsas vəsaitlərin idarə edilməsi\n"
        "Təchizat və satınalma\nAnbar idarəetməsi",
        7,
        id="azerbaijani-diacritics",
    ),
    pytest.param(
        "CASPEL ERP\nCRM, PMS, LRIT\nAZN 1,200,000\nIRISSEA",
        3,
        id="product-terms-and-abbreviations",
    ),
    pytest.param(
        "网络安全服务包括端点保护、威胁检测与响应，以及安全运营中心。",
        9,
        id="chinese",
    ),
    pytest.param(
        "R&D\nQ1 2026\nISO 27001 / ISO 9001\nSLA 99.9%\ninfo@caspel.az",
        12,
        id="legitimate-symbols-and-an-address",
    ),
]


@pytest.mark.parametrize("text,page", CLEAN)
def test_legitimate_text_is_not_flagged(text: str, page: int) -> None:
    assert audit_page(text, page)["defects"] == []


def test_a_short_caption_is_graphics_not_a_defect() -> None:
    """A photo slide with a two-word caption is intact, not broken."""
    result = audit_page("CASPEL\nPartners", 4)
    assert result["graphics_only"] is True
    assert result["defects"] == []


# ---------------------------------------------------------------------------
# Must flag: signals that cannot be legitimate text
# ---------------------------------------------------------------------------


def test_replacement_characters_are_flagged() -> None:
    assert "replacement_characters" in audit_page("Maliyy\ufffd v\ufffd mühasibatlıq", 7)["defects"]


def test_control_characters_are_flagged() -> None:
    assert "control_characters" in audit_page("Data\x07Solutions and analytics", 3)["defects"]


def test_symbol_soup_is_flagged() -> None:
    assert "symbol_density" in audit_page(r"a|b|c|d|e|f~g^h`i\j<k>l{m}n@o", 3)["defects"]


def test_a_repeated_run_is_flagged() -> None:
    body = "Sovereign data infrastructure for the public sector across the region. "
    assert "repeated_run" in audit_page(body * 4, 5)["defects"]


def test_shattered_layout_is_flagged() -> None:
    assert "shattered_words" in audit_page("D a t a S o l u t i o n s f o r", 3)["defects"]


def test_footer_bleed_is_flagged() -> None:
    """The real artifact found in the corpus: the slide number leading the text."""
    assert "footer_bleed" in audit_page("19\nProjects \nDisaster Recovery Center", 19)["defects"]


def test_page_one_is_not_treated_as_footer_bleed() -> None:
    """'1' is too common a token to accuse page one on."""
    assert "footer_bleed" not in audit_page("1 platform, 12 modules, one vendor", 1)["defects"]
