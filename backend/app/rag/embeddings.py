import hashlib
import math
import random
import logging
from typing import List
from app.core.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_EMBEDDING_MODEL
        self.dimension = settings.EMBEDDING_DIMENSION
        self._client_initialized = False

        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self._client_initialized = True
                logger.info(f"Gemini Embedding Service initialized with model: {self.model_name}")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini embeddings: {e}")
        else:
            logger.warning("GEMINI_API_KEY is not set. Using deterministic mock embedding provider for local development/testing.")

    def get_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for a single string."""
        if not text or not text.strip():
            return [0.0] * self.dimension

        if self._client_initialized and self.api_key:
            try:
                import google.generativeai as genai
                result = genai.embed_content(
                    model=f"models/{self.model_name}",
                    content=text,
                    task_type="retrieval_query",
                )
                if "embedding" in result:
                    emb = result["embedding"]
                    if len(emb) == self.dimension:
                        return emb
                    elif len(emb) > self.dimension:
                        return emb[:self.dimension]
                    else:
                        return emb + [0.0] * (self.dimension - len(emb))
            except Exception as e:
                logger.error(f"Error calling Gemini Embedding API: {e}. Falling back to mock embedding.")

        # Deterministic pure-Python hash-based mock embedding for testing without API key
        return self._generate_mock_embedding(text)

    def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts."""
        return [self.get_embedding(t) for t in texts]

    def _generate_mock_embedding(self, text: str) -> List[float]:
        """Deterministic normalized vector for local unit testing and development."""
        seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
        rng = random.Random(seed)
        vec = [rng.gauss(0.0, 1.0) for _ in range(self.dimension)]
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec


embedding_service = EmbeddingService()
