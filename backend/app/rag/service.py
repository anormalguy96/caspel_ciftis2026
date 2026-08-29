import asyncio
import logging
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.presentations import file_sha256
from app.models.entities import ChatMessage, ChatSession, Document, DocumentChunk
from app.rag.embeddings import embedding_service
from app.rag.errors import RagError
from app.rag.extractor import PDFExtractor
from app.rag.generation import generation_service
from app.rag.language import resolve_response_language
from app.rag.retrieval import retrieval_service
from app.schemas.schemas import ChatResponse, ChatSource

logger = logging.getLogger(__name__)


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

        # 1. Retrieve first. If the pipeline cannot run, nothing is persisted.
        retrieved_chunks = await retrieval_service.retrieve(db=db, query=question, top_k=4)

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
        sources = [
            ChatSource(
                document=record.document,
                product=record.product,
                page=record.page,
                score=record.score,
            )
            for record in result.sources
        ]

        return ChatResponse(answer=result.answer, sources=sources, session_id=session_id)


rag_service = RagService()

__all__ = ["RagService", "rag_service", "RagError"]
