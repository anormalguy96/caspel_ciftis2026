import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import settings
from app.core.database import engine, Base
from app.api.routes import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("caspel_ciftis")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing CASPEL CIFTIS 2026 Backend...")
    # Initialize pgvector extension & database tables if not already created
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized successfully with vector extension.")
    except Exception as e:
        logger.warning(f"Database auto-initialization check notice: {e}")

    yield

    logger.info("Shutting down CASPEL CIFTIS 2026 Backend...")
    await engine.dispose()


app = FastAPI(
    title="CASPEL CIFTIS 2026 API",
    version="1.0.0",
    description="Backend API for CASPEL CIFTIS 2026 Exhibition Hub, Leads, Analytics, and CASPEL AI RAG",
    lifespan=lifespan,
)

# CORS configuration (allow frontend origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include main router
app.include_router(router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": "CASPEL CIFTIS 2026 API",
        "status": "operational",
        "docs": "/docs"
    }
