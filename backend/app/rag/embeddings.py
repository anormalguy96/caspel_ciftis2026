import logging
from typing import List, Optional
from app.core.config import settings
from app.rag.errors import EmbeddingError

logger = logging.getLogger(__name__)


# EmbeddingError is imported above and re-exported here so existing callers
# can keep importing it from this module; the type itself lives with the rest
# of the RAG failure taxonomy in app.rag.errors.
__all__ = ["EmbeddingService", "EmbeddingError", "embedding_service"]


class EmbeddingService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_EMBEDDING_MODEL
        self.dimension = settings.EMBEDDING_DIMENSION
        self._client = None

        if self.api_key:
            try:
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
                logger.info(f"Gemini Embedding Service initialized with model: {self.model_name} (dim: {self.dimension})")
            except Exception as e:
                logger.error(f"Failed to initialize the Gemini embedding client: {e}")
        else:
            logger.error("GEMINI_API_KEY is not set. Embedding service is offline.")

    @property
    def is_live_provider(self) -> bool:
        return bool(self._client is not None and self.api_key)

    def get_document_embedding(self, text: str, title: Optional[str] = None) -> List[float]:
        """
        Generate embedding vector for an indexed document chunk using Gemini Embedding 2 formatting.
        Format: "title: {title or 'none'} | text: {text}"
        """
        formatted_text = f"title: {title or 'none'} | text: {text}"
        return self._get_embedding_internal(formatted_text)

    def get_query_embedding(self, query: str) -> List[float]:
        """
        Generate embedding vector for a retrieval query using Gemini Embedding 2 formatting.
        Format: "task: question answering | query: {query}"
        """
        formatted_query = f"task: question answering | query: {query}"
        return self._get_embedding_internal(formatted_query)

    def get_embedding(self, text: str) -> List[float]:
        """Legacy/default helper delegating to query embedding."""
        return self.get_query_embedding(text)

    def _get_embedding_internal(self, text: str) -> List[float]:
        if not text or not text.strip():
            raise EmbeddingError("Cannot generate an embedding for empty text.")

        if self.is_live_provider:
            res = None
            try:
                from google.genai import types
                embed_config = types.EmbedContentConfig(output_dimensionality=self.dimension)

                res = self._client.models.embed_content(
                    model=self.model_name,
                    contents=text,
                    config=embed_config,
                )
            except Exception as e:
                logger.error(f"Gemini embedding call to {self.model_name} failed: {e}")
                raise EmbeddingError(f"Embedding service failure calling {self.model_name}: {e}") from e

            if res is not None:
                if hasattr(res, "embeddings") and res.embeddings is not None:
                    if len(res.embeddings) != 1:
                        raise EmbeddingError(f"Gemini embedding response contained {len(res.embeddings)} embeddings. Expected exactly 1.")
                    first_emb = res.embeddings[0]
                    if hasattr(first_emb, "values") and first_emb.values:
                        emb = list(first_emb.values)
                        if len(emb) == self.dimension:
                            return emb
                        else:
                            raise EmbeddingError(f"Embedding dimension mismatch. Expected {self.dimension}, got {len(emb)}.")
                    else:
                        raise EmbeddingError("Gemini embedding response did not contain 'values' field in the first embedding.")
                raise EmbeddingError("Gemini embedding response did not contain any valid embeddings.")

        raise EmbeddingError(
            "Live Gemini embedding provider is unavailable. Configure a valid "
            "GEMINI_API_KEY and ensure the google-genai client can initialize."
        )

    def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        return [self._get_embedding_internal(t) for t in texts]


embedding_service = EmbeddingService()
