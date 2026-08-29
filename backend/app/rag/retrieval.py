import asyncio
import logging
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Document, DocumentChunk
from app.rag.embeddings import embedding_service
from app.rag.errors import EmbeddingError, RetrievalError

logger = logging.getLogger(__name__)


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


class RetrievalService:
    @staticmethod
    async def retrieve(
        db: AsyncSession,
        query: str,
        top_k: int = 4,
        product_filter: Optional[str] = None,
    ) -> List[RetrievedChunk]:
        """
        Embed the question and run a pgvector cosine-distance search.

        Raises RetrievalError if the embedding provider or the vector store is
        unreachable. An empty list means the corpus genuinely holds nothing
        above the similarity threshold, which is a normal answer.
        """
        if not query or not query.strip():
            return []

        try:
            query_embedding = await asyncio.to_thread(
                embedding_service.get_query_embedding, query
            )
        except EmbeddingError as exc:
            # No query text in the message: visitor-entered content must not be
            # copied into application logs.
            raise RetrievalError(f"Query embedding failed: {exc}") from exc

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

        stmt = stmt.order_by(distance_col.asc()).limit(top_k)

        try:
            result = await db.execute(stmt)
            rows = result.all()
        except Exception as exc:
            raise RetrievalError(f"Vector search failed: {exc}") from exc

        retrieved: List[RetrievedChunk] = []
        for row in rows:
            # Cosine distance runs 0 (identical) to 2 (opposite);
            # similarity = 1 - cosine_distance.
            distance = float(row.distance) if row.distance is not None else 1.0
            similarity = max(0.0, 1.0 - distance)

            if similarity < settings.RAG_SIMILARITY_THRESHOLD:
                continue

            retrieved.append(
                RetrievedChunk(
                    chunk_id=row.id,
                    document_id=row.document_id,
                    document_name=row.document_name,
                    product=row.product,
                    page_number=row.page_number,
                    chunk_index=row.chunk_index,
                    content=row.content,
                    score=round(similarity, 4),
                )
            )

        # Count only. Logging even a truncated preview of the question would put
        # visitor-entered text into the application log.
        logger.info("Retrieved %s chunk(s) above threshold", len(retrieved))
        return retrieved


retrieval_service = RetrievalService()
