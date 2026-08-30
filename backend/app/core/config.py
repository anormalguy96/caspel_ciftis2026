from pathlib import Path
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigurationError(RuntimeError):
    """A production deployment is missing or misconfigured something required."""


class Settings(BaseSettings):
    APP_ENV: str = "development"
    APP_HTTP_PORT: int = 8080

    # PostgreSQL. There is deliberately no default password: a fallback
    # credential in source control is exactly how a development secret ends up
    # protecting a production database.
    POSTGRES_DB: str = "ciftis"
    POSTGRES_USER: str = "ciftis"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    DATABASE_URL: Optional[str] = None

    # Gemini AI.
    #
    # The chat model is chosen by configuration and never by the application.
    # There is deliberately no fallback list: if the configured model cannot
    # answer, that surfaces as an outage rather than being routed to a
    # substitute, because silently answering from a different model than the
    # one a deployment was verified against misrepresents the product.
    #
    # The default below is the model this deployment is currently verified
    # against. Selecting a different one is an environment change only —
    # set GEMINI_CHAT_MODEL in .env (or the container environment) and
    # recreate the backend. No source edit is required.
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_CHAT_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_EMBEDDING_MODEL: str = "gemini-embedding-2"
    #: Separate from the chat model on purpose. Transcription and grounded
    #: answering are different jobs, and swapping one must not silently swap
    #: the other.
    GEMINI_TRANSCRIPTION_MODEL: str = "gemini-3.5-transcribe"
    EMBEDDING_DIMENSION: int = 768
    RAG_SIMILARITY_THRESHOLD: float = 0.70

    # Presentation / Data paths
    DATA_PRESENTATIONS_DIR: str = "/data/presentations"

    # Comma-separated origin allowlist for CORS. Same-origin deployments (nginx
    # serving the SPA and proxying /api) need nothing here.
    CORS_ALLOWED_ORIGINS: str = ""

    # Number of trusted reverse proxies in front of the app. Used to pick the
    # correct entry out of X-Forwarded-For; see app.core.rate_limit.
    TRUSTED_PROXY_COUNT: int = 1

    # Rate limits (slowapi syntax) protecting the unauthenticated endpoints.
    RATE_LIMIT_LEADS: str = "10/hour"
    RATE_LIMIT_CHAT: str = "20/minute"
    #: Tighter than chat: each call uploads a file and runs a provider job.
    RATE_LIMIT_TRANSCRIBE: str = "10/minute"
    RATE_LIMIT_EVENTS: str = "120/minute"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Derived values ────────────────────────────────────────────────

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() == "production"

    @property
    def is_test(self) -> bool:
        return self.APP_ENV.strip().lower() == "test"

    @property
    def async_database_url(self) -> str:
        if self.DATABASE_URL:
            if self.DATABASE_URL.startswith("postgresql://"):
                return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
            return self.DATABASE_URL
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def sync_database_url(self) -> str:
        if self.DATABASE_URL:
            if self.DATABASE_URL.startswith("postgresql+asyncpg://"):
                return self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
            return self.DATABASE_URL
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def cors_origins(self) -> List[str]:
        """
        Explicit CORS origin allowlist.

        In development the Vite dev server runs on a different port, so it is
        allowed by default. In production the SPA and API share an origin, so an
        empty list is the correct and safest answer.
        """
        configured = [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]
        if configured:
            return configured
        if self.APP_ENV.strip().lower() in ("development", "test"):
            return ["http://localhost:5173", "http://127.0.0.1:5173"]
        return []

    @property
    def presentations_dir(self) -> Path:
        """
        Resolved directory holding the genuine presentation PDFs.

        Prefers the container mount (DATA_PRESENTATIONS_DIR) and falls back to
        the repository-relative data/presentations/ when running outside Docker.
        Single source of truth for every presentation route.
        """
        docker_dir = Path(self.DATA_PRESENTATIONS_DIR)
        local_dir = Path(__file__).resolve().parents[3] / "data" / "presentations"
        return (docker_dir if docker_dir.exists() else local_dir).resolve()

    # ── Production guard ──────────────────────────────────────────────

    def production_problems(self) -> List[str]:
        """
        Everything that would make this process unsafe to run in production.

        Returned rather than raised so callers can log the whole list at once —
        an operator fixing a deployment at a stand needs all of it, not the
        first item repeated five times.
        """
        problems: List[str] = []

        if not self.DATABASE_URL and not self.POSTGRES_PASSWORD:
            problems.append("POSTGRES_PASSWORD is empty and no DATABASE_URL was supplied.")
        elif self.POSTGRES_PASSWORD and len(self.POSTGRES_PASSWORD) < 16:
            problems.append("POSTGRES_PASSWORD is shorter than 16 characters.")

        if not (self.GEMINI_API_KEY or "").strip():
            problems.append("GEMINI_API_KEY is not set.")

        if self.EMBEDDING_DIMENSION <= 0:
            problems.append("EMBEDDING_DIMENSION must be positive.")

        if self.TRUSTED_PROXY_COUNT < 1:
            problems.append("TRUSTED_PROXY_COUNT must be at least 1 behind nginx.")

        return problems

    def enforce_production_config(self) -> None:
        """Refuse to start a production process that is not production-ready."""
        if not self.is_production:
            return
        problems = self.production_problems()
        if problems:
            raise ConfigurationError(
                "Refusing to start with APP_ENV=production:\n  - "
                + "\n  - ".join(problems)
            )


settings = Settings()
