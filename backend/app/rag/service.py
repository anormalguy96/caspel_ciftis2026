import logging
import os
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.entities import Document, DocumentChunk, ChatSession, ChatMessage
from app.rag.extractor import PDFExtractor
from app.rag.embeddings import embedding_service
from app.rag.retrieval import retrieval_service, RetrievedChunk
from app.rag.generation import generation_service
from app.schemas.schemas import ChatResponse, ChatSource
from app.core.config import settings

logger = logging.getLogger(__name__)


class RagService:
    @staticmethod
    async def ingest_pdf(
        db: AsyncSession,
        file_path: str,
        document_name: str,
        product: Optional[str] = None,
        source_type: str = "pdf",
    ) -> Document:
        """
        Ingest a PDF presentation: extract slides, generate embeddings, and store in pgvector.
        """
        logger.info(f"Starting ingestion for '{document_name}' from {file_path}")
        pages = PDFExtractor.extract_pages(file_path)
        logger.info(f"Extracted {len(pages)} pages from {file_path}")

        # Check if document already exists; if so, delete old chunks to re-ingest
        existing_doc_res = await db.execute(
            select(Document).where(Document.name == document_name)
        )
        existing_doc = existing_doc_res.scalar_one_or_none()

        if existing_doc:
            doc = existing_doc
            doc.source_path = file_path
            doc.product = product
            doc.source_type = source_type
            # Clear previous chunks
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
            )
        else:
            doc = Document(
                name=document_name,
                source_path=file_path,
                product=product,
                source_type=source_type,
            )
            db.add(doc)
            await db.flush()

        chunks_to_add = []
        for page in pages:
            page_chunks = PDFExtractor.chunk_page(page)
            for ch in page_chunks:
                text = ch["content"]
                emb = embedding_service.get_embedding(text)
                chunk_obj = DocumentChunk(
                    document_id=doc.id,
                    page_number=ch["page_number"],
                    chunk_index=ch["chunk_index"],
                    content=text,
                    embedding=emb,
                )
                chunks_to_add.append(chunk_obj)

        db.add_all(chunks_to_add)
        await db.commit()
        await db.refresh(doc)
        logger.info(f"Successfully ingested '{document_name}' with {len(chunks_to_add)} chunks.")
        return doc

    @staticmethod
    async def ingest_synthetic_text(
        db: AsyncSession,
        document_name: str,
        product: str,
        pages_content: List[str],
    ) -> Document:
        """
        Ingest synthetic/approved test text when PDF files are not yet available locally.
        """
        existing_doc_res = await db.execute(
            select(Document).where(Document.name == document_name)
        )
        existing_doc = existing_doc_res.scalar_one_or_none()

        if existing_doc:
            doc = existing_doc
            doc.product = product
            doc.source_type = "synthetic_text"
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
            )
        else:
            doc = Document(
                name=document_name,
                source_path="synthetic://in-memory",
                product=product,
                source_type="synthetic_text",
            )
            db.add(doc)
            await db.flush()

        chunks_to_add = []
        for idx, text in enumerate(pages_content):
            emb = embedding_service.get_embedding(text)
            chunk_obj = DocumentChunk(
                document_id=doc.id,
                page_number=idx + 1,
                chunk_index=0,
                content=text,
                embedding=emb,
            )
            chunks_to_add.append(chunk_obj)

        db.add_all(chunks_to_add)
        await db.commit()
        await db.refresh(doc)
        logger.info(f"Successfully ingested synthetic doc '{document_name}' with {len(chunks_to_add)} chunks.")
        return doc

    @staticmethod
    async def ask(
        db: AsyncSession,
        session_id: str,
        question: str,
    ) -> ChatResponse:
        """
        Full RAG conversational pipeline with chat session persistence.
        """
        # 1. Ensure chat session exists
        session_res = await db.execute(
            select(ChatSession).where(ChatSession.session_id == session_id)
        )
        chat_sess = session_res.scalar_one_or_none()
        if not chat_sess:
            chat_sess = ChatSession(session_id=session_id)
            db.add(chat_sess)
            await db.flush()

        # 2. Record User Message
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=question,
        )
        db.add(user_msg)

        # 3. Retrieve relevant chunks via pgvector
        retrieved_chunks = await retrieval_service.retrieve(
            db=db,
            query=question,
            top_k=4,
        )

        # 4. Generate grounded answer
        answer = generation_service.generate_response(
            query=question,
            retrieved_chunks=retrieved_chunks,
        )

        # 5. Record Assistant Message
        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=answer,
        )
        db.add(assistant_msg)
        await db.commit()

        # 6. Build response with source metadata
        sources = [
            ChatSource(
                document=c.document_name,
                product=c.product,
                page=c.page_number,
                score=c.score,
            )
            for c in retrieved_chunks
        ]

        return ChatResponse(
            answer=answer,
            sources=sources,
            session_id=session_id,
        )


rag_service = RagService()
