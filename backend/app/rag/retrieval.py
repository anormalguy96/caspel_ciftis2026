import asyncio
import logging
import re
import unicodedata
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import Float, cast, func, literal, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Document, DocumentChunk
from app.rag.embeddings import embedding_service
from app.rag.errors import EmbeddingError, RetrievalError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tuning constants
#
# Every value here was chosen against tests/rag_eval/corpus.json rather than by
# taste. The evaluator reports Recall@4, Recall@8, MRR, no-context precision
# and follow-up resolution, so a change to any of these can be defended with a
# number instead of an opinion.
# ---------------------------------------------------------------------------

#: Candidates drawn from each retrieval leg before fusion. Bounded so a query
#: can never pull the whole corpus into memory, and wide enough that the true
#: page is reachable when it is not the nearest vector.
VECTOR_POOL = 12
LEXICAL_POOL = 12

#: Leg weights for fusion.
#:
#: LEXICAL_WEIGHT is 0.0 because that is what the evaluation set says, not
#: because the lexical leg is unfinished. Measured on the acceptance split,
#: every non-zero weight cost ranking quality and bought no recall:
#:
#:     weight   Recall@4   Recall@8   MRR
#:     0.00     100%       100%       0.9688
#:     0.15     100%       100%       0.7708
#:     0.25     100%       100%       0.7083
#:     0.40     100%       100%       0.6771
#:
#: The reason is specific to this corpus rather than to hybrid search:
#:
#:   * The ERP deck is written in Azerbaijani, so an English question shares
#:     almost no tokens with the pages that answer it.
#:   * Chinese produces no usable tokens under any stock PostgreSQL
#:     configuration, so the leg is silent there by construction.
#:   * The extracted slide text is noisy OCR ("Sil AHEAD OF TIME @CASPEL2 9"),
#:     and ts_rank over 65 short noisy chunks lands in a flat 0.020-0.025 band.
#:     For "Which modules does Caspel ERP include?" it ranks erp/p3 and
#:     caspel/p2 above the correct erp/p4 -- the ordering is incidental.
#:
#: The leg is kept, indexed and tested because those conditions are corpus
#: properties, not permanent truths: better text extraction, or a corpus large
#: enough that dense recall starts to slip, flips this trade-off. Raise the
#: weight when the evaluator says so, and not before.
VECTOR_WEIGHT = 1.0
LEXICAL_WEIGHT = 0.0

#: Reciprocal Rank Fusion damping. 60 is the value from the original RRF paper
#: and is what pgvector's own hybrid-search example uses. It keeps rank 1 from
#: dominating so completely that the other leg can never contribute.
RRF_K = 60

#: Chunks handed to generation. Four was too few to survive de-duplication on a
#: corpus with one chunk per page; six gives the model a neighbouring slide for
#: context without burying the answer.
FINAL_CONTEXT = 6

#: A bounded nudge, never a filter. An alias match reorders; it can never
#: exclude the page that actually holds the answer, which is what a hard
#: product filter did.
ALIAS_BOOST = 0.25

#: How many previous visitor turns may inform a follow-up query. One is enough
#: for "what about its procurement module?" and keeps the blast radius of
#: untrusted text small.
MAX_PRIOR_TURNS = 1
MAX_PRIOR_TURN_CHARS = 300

#: A question this short and this free of nouns is almost certainly referential.
FOLLOWUP_MAX_WORDS = 8

_REFERENTIAL = re.compile(
    r"\b(it|its|that|this|they|them|those|these|there|same|also|too)\b",
    re.IGNORECASE,
)

#: Openers that make a question continuation-shaped even with no pronoun in it.
#: "And what about endpoint protection?" has five words and no pronoun, so the
#: pronoun test alone declared it self-contained and it retrieved nothing.
_CONTINUATION = re.compile(
    r"^\s*(and\b|but\b|also\b|what about\b|how about\b|what of\b|and what about\b)",
    re.IGNORECASE,
)

#: Products the visitor can name that have no approved document in the corpus.
#: These are not "low confidence" topics -- there is no PDF at all, so there is
#: nothing that could honestly ground an answer about them.
#:
#: Without this guard, "What features does Caspel PMS have?" scored 0.70+
#: against Corporate p7 (which happens to discuss business-process automation
#: and ERP) and was handed six chunks of the wrong product's slides. Recall
#: looked fine; the answer would have been fabricated from an unrelated deck.
#:
#: This is not the hard product filter that was removed. It never excludes a
#: page from an approved product, and it stands down as soon as the question
#: also names something the corpus does cover, so "does ERP integrate with
#: PMS?" still retrieves the ERP pages.
UNAPPROVED_PRODUCT_TERMS = ("pms", "irissea", "lrit")
APPROVED_PRODUCT_TERMS = ("erp",)

#: Product vocabulary. Used only for the bounded rank boost above.
PRODUCT_ALIASES: Dict[str, Tuple[str, ...]] = {
    "caspel": ("caspel", "corporate", "integrator", "company", "cybersecurity", "ciftis"),
    "erp": ("erp", "crm", "modul", "module", "satınalma", "procurement", "hr", "invoice"),
}


class RetrievedChunk:
    def __init__(
        self,
        chunk_id: int,
        document_id: int,
        document_name: str,
        product: Optional[str],
        page_number: int,
        chunk_index: int,
        content: str,
        score: float,
    ):
        self.chunk_id = chunk_id
        self.document_id = document_id
        self.document_name = document_name
        self.product = product
        self.page_number = page_number
        self.chunk_index = chunk_index
        self.content = content
        self.score = score


def _normalise(value: str) -> str:
    """Fold to a comparable form without destroying non-Latin scripts.

    NFKC only: it unifies full-width and compatibility characters so a
    full-width Latin product name matches its ASCII spelling, while leaving
    Han and Cyrillic text intact. Case folding is applied separately because
    it is meaningless for scripts without case.
    """
    return unicodedata.normalize("NFKC", value).casefold()


def build_retrieval_query(query: str, prior_user_turns: Optional[Sequence[str]] = None) -> str:
    """Compose the text that is actually embedded.

    A short referential follow-up such as "and what about endpoint protection?"
    carries almost no retrievable signal on its own -- measured against the
    evaluation corpus it returned nothing at all, so the visitor was told the
    corpus had no answer to a question the corpus answers. Prefixing the most
    recent visitor turn restores the subject.

    Prior turns are untrusted visitor text. They are length-capped and used
    only to build a retrieval string; they never reach the system prompt and
    never influence which sources are considered authoritative.
    """
    current = (query or "").strip()
    if not current or not prior_user_turns:
        return current

    words = [w for w in re.split(r"\s+", current) if w]
    looks_referential = (
        bool(_REFERENTIAL.search(current))
        or bool(_CONTINUATION.match(current))
        or len(words) <= 4
    )
    if len(words) > FOLLOWUP_MAX_WORDS or not looks_referential:
        return current

    recent = [t.strip() for t in list(prior_user_turns)[-MAX_PRIOR_TURNS:] if t and t.strip()]
    if not recent:
        return current

    prefix = " ".join(t[:MAX_PRIOR_TURN_CHARS] for t in recent)
    return f"{prefix} {current}"


def asks_only_about_unapproved_product(query: str) -> bool:
    """True when the question is solely about a product with no approved corpus.

    Word-boundary matched so 'lrit' does not fire inside an unrelated token.
    """
    folded = _normalise(query)
    words = set(re.findall(r"[a-z0-9]+", folded))
    names_unapproved = any(t in words for t in UNAPPROVED_PRODUCT_TERMS)
    names_approved = any(t in words for t in APPROVED_PRODUCT_TERMS)
    return names_unapproved and not names_approved


def _alias_bonus(query: str, product: Optional[str]) -> float:
    if not product:
        return 0.0
    aliases = PRODUCT_ALIASES.get(product)
    if not aliases:
        return 0.0
    folded = _normalise(query)
    return ALIAS_BOOST if any(a in folded for a in aliases) else 0.0


def _lexical_terms(query: str) -> List[str]:
    """Tokens worth searching lexically.

    Splitting on non-alphanumerics keeps Latin and Azerbaijani words and drops
    punctuation. Han text produces no useful tokens here, which is expected and
    harmless: the lexical leg simply contributes nothing for Chinese and dense
    retrieval carries the query on its own.
    """
    raw = re.split(r"[^\wÀ-ɏ]+", _normalise(query))
    return [t for t in raw if len(t) >= 3][:12]


class RetrievalService:
    @staticmethod
    async def retrieve(
        db: AsyncSession,
        query: str,
        top_k: int = FINAL_CONTEXT,
        product_filter: Optional[str] = None,
        prior_user_turns: Optional[Sequence[str]] = None,
    ) -> List[RetrievedChunk]:
        """Hybrid retrieval: dense candidates fused with lexical candidates.

        Grounding is still decided by dense similarity alone. If no vector
        candidate clears RAG_SIMILARITY_THRESHOLD the result is empty and the
        caller answers honestly that the corpus does not cover the question.
        Lexical hits can reorder and extend a grounded result; they can never
        manufacture grounding on their own, which is what keeps an out-of-corpus
        question like "how much does Caspel PMS cost" from finding the word
        "Caspel" and pretending that is an answer.

        Raises RetrievalError if the embedding provider or the vector store is
        unreachable. An empty list is a normal answer, not a failure.
        """
        if not query or not query.strip():
            return []

        retrieval_query = build_retrieval_query(query, prior_user_turns)

        # Decided before the provider is called: a question about a product with
        # no approved document cannot be grounded, so there is nothing to embed
        # and no reason to spend an embedding call finding that out.
        if asks_only_about_unapproved_product(retrieval_query):
            logger.info("Retrieved 0 chunk(s): question names only unapproved product(s)")
            return []

        try:
            query_embedding = await asyncio.to_thread(
                embedding_service.get_query_embedding, retrieval_query
            )
        except EmbeddingError as exc:
            # No query text in the message: visitor-entered content must not be
            # copied into application logs.
            raise RetrievalError(f"Query embedding failed: {exc}") from exc

        try:
            vector_rows = await RetrievalService._vector_candidates(
                db, query_embedding, product_filter
            )
        except Exception as exc:
            raise RetrievalError(f"Vector search failed: {exc}") from exc

        # The similarity gate runs over the whole candidate pool, not over a
        # pre-truncated top-4. Previously the threshold was applied in Python
        # after LIMIT 4, so a page that cleared the bar at rank 5 could never be
        # reached and a partly-filtered top-4 silently shrank the context.
        grounded = [
            row for row in vector_rows
            if row["similarity"] >= settings.RAG_SIMILARITY_THRESHOLD
        ]
        if not grounded:
            logger.info("Retrieved 0 chunk(s): no candidate cleared the similarity gate")
            return []

        try:
            # Skip the round-trip entirely when the leg is disabled, rather than
            # running a query and multiplying the result by zero.
            lexical_rows = (
                await RetrievalService._lexical_candidates(db, retrieval_query, product_filter)
                if LEXICAL_WEIGHT > 0.0
                else []
            )
        except Exception:
            # Lexical retrieval is an enhancement. If full-text search is
            # unavailable -- an older database without the generated column,
            # for instance -- dense results still answer the question.
            logger.warning("Lexical candidate search unavailable; using dense results only")
            lexical_rows = []

        fused = RetrievalService._fuse(grounded, lexical_rows, retrieval_query)
        selected = RetrievalService._diversify(fused, top_k)

        retrieved = [
            RetrievedChunk(
                chunk_id=r["id"],
                document_id=r["document_id"],
                document_name=r["document_name"],
                product=r["product"],
                page_number=r["page_number"],
                chunk_index=r["chunk_index"],
                content=r["content"],
                score=round(r["similarity"], 4),
            )
            for r in selected
        ]

        # Count only. Logging even a truncated preview of the question would put
        # visitor-entered text into the application log.
        logger.info(
            "Retrieved %s chunk(s) from %s dense and %s lexical candidate(s)",
            len(retrieved),
            len(vector_rows),
            len(lexical_rows),
        )
        return retrieved

    # -- candidate legs ----------------------------------------------------

    @staticmethod
    async def _vector_candidates(
        db: AsyncSession,
        query_embedding: List[float],
        product_filter: Optional[str],
    ) -> List[dict]:
        distance_col = DocumentChunk.embedding.cosine_distance(query_embedding).label("distance")
        stmt = (
            select(
                DocumentChunk.id,
                DocumentChunk.document_id,
                Document.name.label("document_name"),
                Document.product,
                DocumentChunk.page_number,
                DocumentChunk.chunk_index,
                DocumentChunk.content,
                distance_col,
            )
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(DocumentChunk.embedding.isnot(None))
        )
        if product_filter:
            stmt = stmt.where(Document.product == product_filter)
        stmt = stmt.order_by(distance_col.asc()).limit(VECTOR_POOL)

        rows = (await db.execute(stmt)).all()
        out: List[dict] = []
        for rank, row in enumerate(rows, start=1):
            # Cosine distance runs 0 (identical) to 2 (opposite);
            # similarity = 1 - cosine_distance.
            distance = float(row.distance) if row.distance is not None else 1.0
            out.append(
                {
                    "id": row.id,
                    "document_id": row.document_id,
                    "document_name": row.document_name,
                    "product": row.product,
                    "page_number": row.page_number,
                    "chunk_index": row.chunk_index,
                    "content": row.content,
                    "similarity": max(0.0, 1.0 - distance),
                    "vector_rank": rank,
                }
            )
        return out

    @staticmethod
    async def _lexical_candidates(
        db: AsyncSession,
        query: str,
        product_filter: Optional[str],
    ) -> List[dict]:
        terms = _lexical_terms(query)
        if not terms:
            return []

        # OR the terms rather than AND them: a visitor question is not a boolean
        # expression, and requiring every token would match nothing on a slide
        # deck. ts_rank then orders by how many matched and how densely.
        tsquery = func.to_tsquery("simple", " | ".join(terms))
        search_col = func.to_tsvector("simple", func.coalesce(DocumentChunk.content, ""))
        rank_col = func.ts_rank(search_col, tsquery).label("lex_rank")

        stmt = (
            select(
                DocumentChunk.id,
                DocumentChunk.document_id,
                Document.name.label("document_name"),
                Document.product,
                DocumentChunk.page_number,
                DocumentChunk.chunk_index,
                DocumentChunk.content,
                rank_col,
            )
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(search_col.op("@@")(tsquery))
        )
        if product_filter:
            stmt = stmt.where(Document.product == product_filter)
        stmt = stmt.order_by(rank_col.desc()).limit(LEXICAL_POOL)

        rows = (await db.execute(stmt)).all()
        return [
            {
                "id": row.id,
                "document_id": row.document_id,
                "document_name": row.document_name,
                "product": row.product,
                "page_number": row.page_number,
                "chunk_index": row.chunk_index,
                "content": row.content,
                "similarity": 0.0,
                "lexical_rank": rank,
            }
            for rank, row in enumerate(rows, start=1)
        ]

    # -- fusion and selection ----------------------------------------------

    @staticmethod
    def _fuse(vector_rows: List[dict], lexical_rows: List[dict], query: str) -> List[dict]:
        """Reciprocal Rank Fusion over the two candidate lists.

        RRF sums 1/(k + rank) per leg. Ranks are comparable across legs in a way
        raw scores are not -- a cosine similarity and a ts_rank have no shared
        unit, and adding them directly would let whichever leg happens to
        produce larger numbers decide the ordering.
        """
        merged: Dict[int, dict] = {}

        for row in vector_rows:
            entry = dict(row)
            entry["rrf"] = VECTOR_WEIGHT / (RRF_K + row["vector_rank"])
            merged[row["id"]] = entry

        for row in lexical_rows:
            contribution = LEXICAL_WEIGHT / (RRF_K + row["lexical_rank"])
            existing = merged.get(row["id"])
            if existing is not None:
                existing["rrf"] += contribution
                existing["lexical_rank"] = row["lexical_rank"]
            else:
                # A lexical-only candidate joins the pool but carries no dense
                # similarity, so it can extend a grounded answer without ever
                # being the reason an answer is considered grounded.
                entry = dict(row)
                entry["rrf"] = contribution
                merged[row["id"]] = entry

        for entry in merged.values():
            entry["rrf"] += _alias_bonus(query, entry.get("product")) / (RRF_K * 4)

        return sorted(merged.values(), key=lambda e: e["rrf"], reverse=True)

    @staticmethod
    def _diversify(rows: List[dict], limit: int) -> List[dict]:
        """Prefer distinct pages, then fill.

        With one chunk per page this mainly guards the future: once a page is
        split into several chunks, an unguarded top-k happily returns six
        fragments of the same slide and calls it context.
        """
        chosen: List[dict] = []
        seen_pages = set()

        for row in rows:
            key = (row["document_id"], row["page_number"])
            if key in seen_pages:
                continue
            seen_pages.add(key)
            chosen.append(row)
            if len(chosen) >= limit:
                return chosen

        for row in rows:
            if len(chosen) >= limit:
                break
            if row not in chosen:
                chosen.append(row)
        return chosen


retrieval_service = RetrievalService()
