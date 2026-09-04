import asyncio
import logging
from typing import List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.presentations import PRESENTATIONS, file_sha256
from app.models.entities import ChatMessage, ChatSession, Document, DocumentChunk
from app.rag.embeddings import embedding_service
from app.rag.errors import RagError
from app.rag.extractor import PDFExtractor
from app.rag.generation import generation_service
from app.rag.language import language_instruction, resolve_response_language
from app.rag.retrieval import retrieval_service
from app.schemas.schemas import ChatResponse, ChatSource

logger = logging.getLogger(__name__)


def _build_public_sources(records) -> List[ChatSource]:
    """Turn verified retrieval records into de-duplicated, linkable citations.

    Anything whose slug is not registered, or whose page falls outside the
    approved document's real page count, is dropped rather than repaired. A
    citation the client cannot open is worse than one fewer citation.
    """
    seen: set = set()
    out: List[ChatSource] = []

    for record in records:
        slug = (record.product or "").strip().lower() or None
        spec = PRESENTATIONS.get(slug) if slug else None

        if spec is None or not spec.is_registered:
            logger.warning("Dropping citation for unregistered slug")
            continue
        if not isinstance(record.page, int) or record.page < 1 or record.page > spec.page_count:
            logger.warning("Dropping citation with an out-of-range page")
            continue

        key = (slug, record.page)
        if key in seen:
            continue
        seen.add(key)

        out.append(
            ChatSource(
                document=record.document,
                product=record.product,
                page=record.page,
                slug=slug,
                score=record.score,
            )
        )

    return out


class RagService:
    @staticmethod
    async def ingest_pdf(
        db: AsyncSession,
        file_path: str,
        document_name: str,
        product: Optional[str] = None,
        source_sha256: Optional[str] = None,
    ) -> Document:
        """
        Ingest a PDF presentation: extract slides, embed them, store in pgvector.

        The SHA256 of the exact file that was read is recorded on the document
        row. Without it there is no way to tell, later, whether the corpus was
        built from the approved deck or from something that replaced it.
        """
        from pathlib import Path

        logger.info("Starting ingestion for '%s'", document_name)
        extraction = PDFExtractor.extract(file_path)
        pages = extraction.pages
        logger.info(
            "Extracted %s/%s page(s) from '%s' (%s via OCR, %s with no extractable text)",
            len(pages), extraction.total_pages, document_name,
            len(extraction.ocr_page_numbers), len(extraction.empty_page_numbers),
        )

        if not pages:
            # Unreadable pages are skipped rather than substituted, so an
            # image-only deck yields nothing. Fail loudly rather than register a
            # document the assistant can never answer from.
            raise RuntimeError(
                f"No extractable text found in '{document_name}' ({file_path}). "
                "The PDF is likely image-only — install OCR support (pytesseract, "
                "Pillow, tesseract) or supply a text-bearing PDF."
            )

        digest = source_sha256 or file_sha256(Path(file_path))

        existing_doc_res = await db.execute(
            select(Document).where(Document.name == document_name)
        )
        doc = existing_doc_res.scalar_one_or_none()

        if doc is not None:
            doc.source_path = file_path
            doc.product = product
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
            )
        else:
            doc = Document(name=document_name, source_path=file_path, product=product)
            db.add(doc)

        doc.source_sha256 = digest
        doc.source_page_count = extraction.total_pages
        doc.pages_with_text = len(pages)
        doc.pages_via_ocr = len(extraction.ocr_page_numbers)
        doc.pages_without_text = len(extraction.empty_page_numbers)
        await db.flush()

        chunks_to_add = []
        for page in pages:
            for ch in PDFExtractor.chunk_page(page):
                text = ch["content"]
                emb = await asyncio.to_thread(
                    embedding_service.get_document_embedding, text, doc.name
                )
                chunks_to_add.append(
                    DocumentChunk(
                        document_id=doc.id,
                        page_number=ch["page_number"],
                        chunk_index=ch["chunk_index"],
                        content=text,
                        embedding=emb,
                    )
                )

        db.add_all(chunks_to_add)
        await db.commit()
        await db.refresh(doc)
        logger.info(
            "Ingested '%s': %s chunk(s), source sha256 %s",
            document_name, len(chunks_to_add), digest,
        )
        return doc

    #: How many previous visitor turns may inform a follow-up retrieval query.
    #: Deliberately small: this is untrusted visitor text, and one turn is
    #: enough to resolve "it" / "its" / "that" in practice.
    FOLLOWUP_TURNS = 1
    FOLLOWUP_TURN_CHARS = 300

    @staticmethod
    async def _recent_user_turns(db: AsyncSession, session_id: str) -> List[str]:
        """The last visitor turns from THIS session, oldest first.

        Scoped to one session on purpose. Retrieving against a global
        conversation history would let one visitor's question steer another
        visitor's retrieval, which is both wrong and a privacy problem.
        """
        stmt = (
            select(ChatMessage.content)
            .where(ChatMessage.session_id == session_id, ChatMessage.role == "user")
            .order_by(ChatMessage.id.desc())
            .limit(RagService.FOLLOWUP_TURNS)
        )
        rows = (await db.execute(stmt)).scalars().all()
        return [r[: RagService.FOLLOWUP_TURN_CHARS] for r in reversed(rows) if r]

    @staticmethod
    async def prepare_stream(
        db: AsyncSession,
        session_id: str,
        question: str,
        ui_locale: Optional[str] = None,
    ):
        """Everything needed to stream an answer, resolved before the first byte.

        Returns (records, chunks, response_language, persist).

        Retrieval, language resolution and the architecture choice all happen
        here, while the response can still legitimately be a 4xx/5xx. Once the
        first token has gone out the status line is already 200, so anything
        that could fail with a status has to fail before that point.

        `persist` is a callable the route invokes only after a stream
        completes. A transcript entry for an answer that failed halfway would
        count an outage as an answered question.
        """
        response_language = resolve_response_language(question, ui_locale)
        prior_user_turns = await RagService._recent_user_turns(db, session_id)

        prompt_override = None
        records_source = []

        if settings.AI_CONTEXT_MODE == "full_context":
            # The experimental arm. Server-selected only; the browser cannot
            # reach it. Retrieval is skipped entirely and the whole approved
            # corpus is serialised into the prompt.
            from app.rag.full_context import (
                build_corpus_block,
                build_full_context_prompt,
                load_corpus_records,
            )

            corpus_records = await load_corpus_records(db)
            history = [{"role": "user", "content": t} for t in prior_user_turns]
            prompt_override = build_full_context_prompt(
                build_corpus_block(corpus_records),
                question,
                language_instruction(response_language),
                history,
            )
            records_source = corpus_records
            chunks_for_generation = corpus_records
        else:
            retrieved = await retrieval_service.retrieve(
                db=db, query=question, prior_user_turns=prior_user_turns
            )
            records_source = retrieved
            chunks_for_generation = retrieved

        records, chunk_iter = await asyncio.to_thread(
            generation_service.stream_response,
            question,
            chunks_for_generation,
            response_language,
            prompt_override,
        )

        # full_context supplies SourceRecords directly rather than chunks, so
        # the records it hands back are already the right objects.
        if settings.AI_CONTEXT_MODE == "full_context":
            records = records_source

        async def persist(answer_text: str) -> None:
            if not answer_text.strip():
                return
            session = (
                await db.execute(
                    select(ChatSession).where(ChatSession.session_id == session_id)
                )
            ).scalar_one_or_none()
            if session is None:
                db.add(ChatSession(session_id=session_id))
                await db.flush()
            db.add(ChatMessage(session_id=session_id, role="user", content=question))
            db.add(
                ChatMessage(session_id=session_id, role="assistant", content=answer_text)
            )
            await db.commit()

        return records, chunk_iter, response_language, persist

    @staticmethod
    async def ask(
        db: AsyncSession,
        session_id: str,
        question: str,
        ui_locale: Optional[str] = None,
    ) -> ChatResponse:
        """
        Full RAG conversational pipeline with chat session persistence.

        Retrieval and generation failures propagate as RagError. Nothing is
        written to the transcript unless a real answer was produced: recording
        an outage as an assistant message would make the failure indistinguishable
        from a reply in every downstream count.

        `ui_locale` is a hint, not a instruction. The visitor's own question
        decides the response language; the browser's locale only breaks a tie
        when the message is too short to classify.
        """
        # The language decision is made here, offline, before any provider is
        # involved. It never depends on what the model feels like answering in.
        response_language = resolve_response_language(question, ui_locale)

        # A short referential follow-up ("what about its procurement module?")
        # embeds to almost nothing on its own and was returning zero chunks, so
        # the visitor was told the corpus had no answer to a question it does
        # answer. The most recent visitor turn from THIS session restores the
        # subject. It is bounded, and it is used only to build the retrieval
        # string -- it never reaches the system prompt.
        prior_user_turns = await RagService._recent_user_turns(db, session_id)

        # 1. Retrieve first. If the pipeline cannot run, nothing is persisted.
        retrieved_chunks = await retrieval_service.retrieve(
            db=db,
            query=question,
            prior_user_turns=prior_user_turns,
        )

        # 2. Generate. Raises rather than returning a stand-in sentence.
        result = await asyncio.to_thread(
            generation_service.generate_response,
            question,
            retrieved_chunks,
            None,
            response_language,
        )

        # 3. Only now is there an exchange worth storing.
        session_res = await db.execute(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        if session_res.scalar_one_or_none() is None:
            db.add(ChatSession(session_id=session_id))
            await db.flush()

        db.add(ChatMessage(session_id=session_id, role="user", content=question))
        db.add(ChatMessage(session_id=session_id, role="assistant", content=result.answer))
        await db.commit()

        # Only citations the server could verify against what was actually
        # retrieved. A title or page the model wrote itself never gets here.
        #
        # Two further guarantees are added on the way out, because these
        # citations become clickable deep links in the client:
        #
        #   * the slug must be a registered presentation, and the page must be
        #     inside that document's real page count, so a link can never point
        #     at a missing document or a page past the end of it;
        #   * repeated slug/page pairs collapse, so an answer that cites the
        #     same slide three times shows one citation rather than three.
        sources = _build_public_sources(result.sources)

        return ChatResponse(answer=result.answer, sources=sources, session_id=session_id)


rag_service = RagService()

__all__ = ["RagService", "rag_service", "RagError"]
