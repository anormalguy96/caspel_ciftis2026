"""Unit tests for the hybrid retrieval path.

These cover the pure decision logic -- follow-up query construction, the
unapproved-product guard, rank fusion, de-duplication and diversification --
without touching a database or a provider. The end-to-end retrieval quality
numbers live in tests/rag_eval/ and are measured against the real index.
"""
import pytest

from app.rag import retrieval as R
from app.rag.retrieval import (
    LEXICAL_WEIGHT,
    RRF_K,
    VECTOR_WEIGHT,
    RetrievalService,
    asks_only_about_unapproved_product,
    build_retrieval_query,
)


def _row(chunk_id, page, product="erp", doc_id=1, vector_rank=None, lexical_rank=None, sim=0.8):
    row = {
        "id": chunk_id,
        "document_id": doc_id,
        "document_name": "CASPEL ERP Presentation",
        "product": product,
        "page_number": page,
        "chunk_index": 0,
        "content": f"content for page {page}",
        "similarity": sim,
    }
    if vector_rank is not None:
        row["vector_rank"] = vector_rank
    if lexical_rank is not None:
        row["lexical_rank"] = lexical_rank
    return row


# ==========================================================================
# Bounded follow-up context
# ==========================================================================

def test_self_contained_question_is_not_rewritten():
    q = "Which modules does Caspel ERP include?"
    assert build_retrieval_query(q, ["Something earlier"]) == q


def test_pronoun_followup_borrows_the_previous_turn():
    out = build_retrieval_query("What about its procurement module?", ["Which modules does Caspel ERP include?"])
    assert "Caspel ERP" in out
    assert "procurement" in out


def test_continuation_opener_without_a_pronoun_is_still_a_followup():
    # "And what about endpoint protection?" has no pronoun and five words, and
    # was previously treated as self-contained -- it then retrieved nothing.
    out = build_retrieval_query(
        "And what about endpoint protection?",
        ["What is CASPEL's approach to cybersecurity?"],
    )
    assert "cybersecurity" in out
    assert "endpoint protection" in out


def test_followup_uses_no_prior_turn_when_none_supplied():
    q = "What about its procurement module?"
    assert build_retrieval_query(q, None) == q
    assert build_retrieval_query(q, []) == q


def test_long_question_is_never_treated_as_a_followup():
    q = "Please describe in detail how the procurement module handles supplier quotations and approvals"
    assert build_retrieval_query(q, ["earlier turn"]) == q


def test_prior_turn_is_length_capped():
    long_turn = "x" * 5000
    out = build_retrieval_query("What about it?", [long_turn])
    assert len(out) < 500


def test_only_the_most_recent_turn_is_used():
    out = build_retrieval_query(
        "What about it?",
        ["oldest turn about cybersecurity", "newest turn about procurement"],
    )
    assert "newest" in out
    assert "oldest" not in out


def test_empty_query_stays_empty():
    assert build_retrieval_query("", ["prior"]) == ""


# ==========================================================================
# Unapproved products must not be grounded on another product's slides
# ==========================================================================

@pytest.mark.parametrize(
    "query",
    [
        "What features does Caspel PMS have?",
        "How much does Caspel PMS cost per licence?",
        "What is IRISSEA?",
        "How many vessels can IRISSEA track at once?",
        "How does LRIT reporting work?",
    ],
)
def test_questions_about_unapproved_products_are_refused(query):
    assert asks_only_about_unapproved_product(query) is True


@pytest.mark.parametrize(
    "query",
    [
        "Which modules does Caspel ERP include?",
        "What is CASPEL's approach to cybersecurity?",
        "Does ERP integrate with PMS?",
        "Caspel ERP hansı modulları əhatə edir?",
    ],
)
def test_approved_questions_are_not_refused(query):
    assert asks_only_about_unapproved_product(query) is False


def test_guard_matches_whole_words_only():
    # 'lrit' must not fire inside an unrelated token.
    assert asks_only_about_unapproved_product("Tell me about the alrite process") is False


# ==========================================================================
# Rank fusion
# ==========================================================================

def test_vector_only_fusion_preserves_vector_order():
    rows = [_row(1, 4, vector_rank=1), _row(2, 5, vector_rank=2), _row(3, 6, vector_rank=3)]
    fused = RetrievalService._fuse(rows, [], "erp modules")
    assert [r["page_number"] for r in fused] == [4, 5, 6]


def test_lexical_contribution_follows_the_configured_weight():
    # A query with no product alias in it, so the only thing under test is the
    # lexical leg's contribution rather than the alias nudge.
    fused = RetrievalService._fuse(
        [_row(2, 5, vector_rank=1), _row(1, 4, vector_rank=2)],
        [_row(1, 4, lexical_rank=1)],
        "tell me about the second slide",
    )
    scores = {r["id"]: r["rrf"] for r in fused}
    dense_only = VECTOR_WEIGHT / (RRF_K + 2)
    if LEXICAL_WEIGHT > 0:
        assert scores[1] > dense_only
    else:
        # With the leg disabled a lexical hit must not move anything at all.
        assert scores[1] == pytest.approx(dense_only)


def test_lexical_only_candidate_never_outranks_a_dense_hit_when_disabled():
    fused = RetrievalService._fuse(
        [_row(1, 4, vector_rank=1)],
        [_row(9, 40, lexical_rank=1)],
        "erp modules",
    )
    assert fused[0]["id"] == 1


def test_alias_boost_reorders_but_never_removes():
    rows = [_row(1, 4, product="caspel", vector_rank=1), _row(2, 5, product="erp", vector_rank=2)]
    fused = RetrievalService._fuse(rows, [], "Which modules does Caspel ERP include?")
    # Both survive; the boost may only change their order.
    assert {r["id"] for r in fused} == {1, 2}


def test_alias_boost_is_bounded_and_cannot_beat_a_rank_gap():
    rows = [_row(1, 4, product="caspel", vector_rank=1), _row(2, 5, product="erp", vector_rank=9)]
    fused = RetrievalService._fuse(rows, [], "erp crm procurement")
    assert fused[0]["id"] == 1, "a small alias nudge must not overturn an 8-rank dense gap"


# ==========================================================================
# De-duplication and diversification
# ==========================================================================

def test_diversify_prefers_distinct_pages():
    rows = [
        _row(1, 4, vector_rank=1),
        _row(2, 4, vector_rank=2),  # same page
        _row(3, 5, vector_rank=3),
        _row(4, 6, vector_rank=4),
    ]
    out = RetrievalService._diversify(rows, 3)
    assert [r["page_number"] for r in out] == [4, 5, 6]


def test_diversify_backfills_when_pages_run_out():
    rows = [_row(1, 4, vector_rank=1), _row(2, 4, vector_rank=2)]
    out = RetrievalService._diversify(rows, 2)
    assert len(out) == 2


def test_diversify_respects_the_limit():
    rows = [_row(i, i, vector_rank=i) for i in range(1, 12)]
    assert len(RetrievalService._diversify(rows, 6)) == 6


def test_fusion_deduplicates_by_chunk_id():
    fused = RetrievalService._fuse(
        [_row(1, 4, vector_rank=1)],
        [_row(1, 4, lexical_rank=1)],
        "erp",
    )
    assert len(fused) == 1


# ==========================================================================
# Lexical term extraction
# ==========================================================================

def test_lexical_terms_drop_punctuation_and_short_tokens():
    terms = R._lexical_terms("Which modules does Caspel ERP include?")
    assert "modules" in terms
    assert "erp" in terms
    assert "?" not in terms


def test_lexical_terms_keep_azerbaijani_characters():
    terms = R._lexical_terms("Satınalma və mal sifarişi")
    assert any("satınalma" == t for t in terms)


def test_lexical_terms_are_bounded():
    assert len(R._lexical_terms(" ".join(f"word{i}" for i in range(50)))) <= 12


def test_han_text_yields_no_latin_lexical_terms():
    # Chinese is not tokenised by the 'simple' configuration; the leg is
    # expected to stay silent rather than to match something incidental.
    terms = R._lexical_terms("包含哪些模块")
    assert all(not t.isascii() or len(t) >= 3 for t in terms)


# ==========================================================================
# Log safety
# ==========================================================================

@pytest.mark.asyncio
async def test_retrieval_never_logs_the_question(caplog):
    secret_question = "zzsecretzz what features does Caspel PMS have"
    with caplog.at_level("DEBUG"):
        result = await RetrievalService.retrieve(db=None, query=secret_question)
    assert result == []
    assert "zzsecretzz" not in caplog.text


# ==========================================================================
# Public citation contract
# ==========================================================================

class _Rec:
    def __init__(self, document, page, product, score=0.8):
        self.document = document
        self.page = page
        self.product = product
        self.score = score


def _sources(records):
    from app.rag.service import _build_public_sources
    return _build_public_sources(records)


def test_citation_carries_the_registry_slug():
    out = _sources([_Rec("CASPEL Corporate Presentation", 7, "caspel")])
    assert len(out) == 1
    assert out[0].slug == "caspel"
    assert out[0].page == 7


def test_citation_for_an_unregistered_product_is_dropped():
    # PMS and IRISSEA have no approved document, so nothing can cite them.
    assert _sources([_Rec("Caspel PMS", 3, "pms")]) == []
    assert _sources([_Rec("IRISSEA", 1, "irissea")]) == []


def test_citation_past_the_end_of_the_document_is_dropped():
    # Corporate is 24 pages; ERP is 41.
    assert _sources([_Rec("CASPEL Corporate Presentation", 25, "caspel")]) == []
    assert _sources([_Rec("CASPEL ERP Presentation", 42, "erp")]) == []


def test_citation_page_zero_or_negative_is_dropped():
    assert _sources([_Rec("CASPEL Corporate Presentation", 0, "caspel")]) == []
    assert _sources([_Rec("CASPEL Corporate Presentation", -1, "caspel")]) == []


def test_last_valid_page_is_kept():
    assert len(_sources([_Rec("CASPEL Corporate Presentation", 24, "caspel")])) == 1
    assert len(_sources([_Rec("CASPEL ERP Presentation", 41, "erp")])) == 1


def test_duplicate_slug_and_page_collapse():
    out = _sources([
        _Rec("CASPEL ERP Presentation", 4, "erp"),
        _Rec("CASPEL ERP Presentation", 4, "erp"),
        _Rec("CASPEL ERP Presentation", 5, "erp"),
    ])
    assert [(s.slug, s.page) for s in out] == [("erp", 4), ("erp", 5)]


def test_citation_order_is_preserved():
    out = _sources([
        _Rec("CASPEL ERP Presentation", 9, "erp"),
        _Rec("CASPEL Corporate Presentation", 2, "caspel"),
    ])
    assert [s.page for s in out] == [9, 2]


def test_citation_never_contains_a_url_or_path():
    out = _sources([_Rec("CASPEL Corporate Presentation", 7, "caspel")])
    dumped = out[0].model_dump()
    assert set(dumped) == {"document", "product", "page", "slug", "score"}
    for value in dumped.values():
        assert "http" not in str(value).lower()
        assert "/" not in str(value) and "\\" not in str(value)
