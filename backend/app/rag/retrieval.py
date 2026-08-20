import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.entities import DocumentChunk, Document
from app.rag.embeddings import embedding_service

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
        Compute query embedding and perform cosine distance similarity search in pgvector.
        """
        if not query or not query.strip():
            return []

        query_embedding = embedding_service.get_embedding(query)

        # Build query using pgvector cosine_distance
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

        result = await db.execute(stmt)
        rows = result.all()

        retrieved: List[RetrievedChunk] = []
        for row in rows:
            # Cosine distance ranges from 0 (identical) to 2 (opposite)
            # Similarity score = 1 - (distance / 2)
            distance = float(row.distance) if row.distance is not None else 1.0
            similarity = max(0.0, 1.0 - (distance / 2.0))

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

        logger.info(f"Retrieved {len(retrieved)} chunks for query: '{query[:50]}...'")
        return retrieved


retrieval_service = RetrievalService()
