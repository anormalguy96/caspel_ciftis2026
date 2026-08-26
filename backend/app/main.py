import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings
from app.core.database import engine
from app.core.rate_limit import install_rate_limiting

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("caspel_ciftis")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Refuse to come up misconfigured rather than serving an exhibition from a
    # process with a weak database password or a mocked assistant.
    settings.enforce_production_config()

    logger.info("Starting CASPEL CIFTIS 2026 backend (env=%s)", settings.APP_ENV)
    yield

    logger.info("Shutting down CASPEL CIFTIS 2026 backend")
    if not settings.is_test:
        await engine.dispose()


app = FastAPI(
    title="CASPEL CIFTIS 2026 API",
    version="1.0.0",
    description="Public API for the CASPEL CIFTIS 2026 exhibition hub",
    lifespan=lifespan,
    # The interactive schema browsers are a development convenience. In
    # production they publish the full API surface to anyone who finds /docs.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# CORS: an explicit allowlist. "*" together with allow_credentials makes
# Starlette echo back any requesting origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Rate limiting for the unauthenticated, cost-bearing endpoints. Must be
# installed before the routers that use it.
install_rate_limiting(app)

app.include_router(router, prefix="/api")


# There is deliberately no /presentations/{filename} route. Presentation bytes
# are served only through /api/presentations/{slug}/stream and /download, which
# verify the file against its approved SHA256 first. A filename-addressed route
# bypassed that check entirely and served whatever was in the directory.


@app.get("/")
async def root():
    return {"service": "CASPEL CIFTIS 2026 API", "status": "operational"}
