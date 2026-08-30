import logging
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import settings
from app.core.database import get_db
from app.core.presentations import PRESENTATIONS, REGISTERED_SLUGS, verify
from app.core.rate_limit import limiter
from app.models.entities import AnalyticsEvent, Document, DocumentChunk, Lead
from app.rag.embeddings import embedding_service
from app.rag.errors import RagError
from app.rag.generation import generation_service
from app.rag.service import rag_service
from app.schemas.schemas import (
    ChatRequest,
    ChatResponse,
    EventCreate,
    EventResponse,
    HealthResponse,
    LeadCreate,
    LeadResponse,
    PresentationItem,
    ReadyChecks,
    ReadyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

MIN_GENUINE_PDF_BYTES = 100_000


class _DynamicAllowlist(dict):
    def __getitem__(self, key):
        spec = PRESENTATIONS[key]
        return {"filename": spec.filename, "name": spec.name}
    def __contains__(self, key):
        return key in PRESENTATIONS
    def get(self, key, default=None):
        if key in PRESENTATIONS:
            spec = PRESENTATIONS[key]
            return {"filename": spec.filename, "name": spec.name}
        return default
    def items(self):
        return [(k, {"filename": v.filename, "name": v.name}) for k, v in PRESENTATIONS.items()]

PRESENTATION_ALLOWLIST = _DynamicAllowlist()


# --------------------------------------------------------------------------
# Liveness and readiness
# --------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    Liveness only. See HealthResponse for why nothing else is disclosed here.
    """
    try:
        await db.execute(text("SELECT 1"))
        return HealthResponse(status="healthy")
    except Exception as e:
        # Detail goes to the server log, not to the caller.
        logger.error("Health check database connection failed: %s", e)
        return HealthResponse(status="degraded")


async def _vector_extension_present(db: AsyncSession) -> bool:
    bind = db.bind
    if bind is not None and bind.dialect.name == "sqlite":
        # The test database has no extension registry; the schema it builds
        # already carries the vector columns.
        return True
    try:
        res = await db.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
        )
        return res.scalar_one_or_none() == "vector"
    except Exception as e:
        logger.warning("Vector extension check failed: %s", e)
        return False


async def _approved_corpus_present(db: AsyncSession) -> bool:
    """
    Every approved deck is represented by a document whose recorded source
    SHA256 matches the approved digest, and that document has chunks with
    non-null embeddings of the configured dimension.

    One arbitrary row in `documents` is not a production knowledge base. A
    corpus built from a replaced file, or one whose embeddings never landed,
    must not be reported ready.
    """
    if not REGISTERED_SLUGS:
        return False

    for slug in REGISTERED_SLUGS:
        spec = PRESENTATIONS[slug]
        doc_res = await db.execute(
            select(Document.id).where(Document.source_sha256 == spec.sha256)
        )
        doc_ids = [row[0] for row in doc_res.all()]
        if not doc_ids:
            logger.warning("Readiness: no document recorded for %s source hash", slug)
            return False

        chunk_count = await db.scalar(
            select(func.count())
            .select_from(DocumentChunk)
            .where(DocumentChunk.document_id.in_(doc_ids))
        )
        if not chunk_count:
            logger.warning("Readiness: %s has no chunks", slug)
            return False

        null_embeddings = await db.scalar(
            select(func.count())
            .select_from(DocumentChunk)
            .where(
                DocumentChunk.document_id.in_(doc_ids),
                DocumentChunk.embedding.is_(None),
            )
        )
        if null_embeddings:
            logger.warning("Readiness: %s has %s chunk(s) with no embedding", slug, null_embeddings)
            return False

    return True


@router.get("/ready", response_model=ReadyResponse)
async def ready_check(response: Response, db: AsyncSession = Depends(get_db)):
    """
    Readiness probe.

    Reports pass/fail per dependency and nothing more: model names, document
    counts and environment labels are operational detail and this endpoint is
    publicly reachable. The exact figures are written to the server log and
    printed by the ingestion script.
    """
    database = False
    vector_extension = False
    approved_corpus = False

    try:
        await db.execute(text("SELECT 1"))
        database = True
        vector_extension = await _vector_extension_present(db)
        if vector_extension:
            approved_corpus = await _approved_corpus_present(db)
    except Exception as e:
        logger.error("Ready check error: %s", e)

    live_ai_provider = bool(
        (settings.GEMINI_API_KEY or "").strip()
        and embedding_service.is_live_provider
        and generation_service.is_live_provider
    )
    checks = ReadyChecks(
        database=database,
        vector_extension=vector_extension,
        live_ai_provider=live_ai_provider,
        approved_corpus=approved_corpus,
    )

    is_ready = all([database, vector_extension, live_ai_provider, approved_corpus])
    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadyResponse(status="ready" if is_ready else "not_ready", checks=checks)


# --------------------------------------------------------------------------
# Presentations
# --------------------------------------------------------------------------

def _verified_path(slug: str):
    """
    Resolve a slug to a file that has passed full integrity verification.

    Everything that is not a genuine, approved, parseable deck is a 404. The
    reason is logged, not returned: telling a caller the difference between
    "unknown slug", "hash mismatch" and "file missing" maps the deployment for
    them at no cost.
    """
    result = verify(slug)
    if result.ok and result.path is not None:
        return result.path

    logger.warning("Refusing to serve presentation %r: %s", slug, result.reason)
    raise HTTPException(status_code=404, detail="Presentation not available")


@router.get("/presentations", response_model=Dict[str, PresentationItem])
async def get_presentation_manifest():
    """
    Availability manifest.

    A deck is available only if the file on disk is byte-for-byte the approved
    one, parses as a PDF, and has the approved page count.
    """
    manifest: Dict[str, PresentationItem] = {}

    for slug, spec in PRESENTATIONS.items():
        result = verify(slug)
        manifest[slug] = PresentationItem(
            slug=slug,
            name=spec.name,
            available=result.ok,
            download_filename=spec.filename,
            size_bytes=result.size_bytes if result.ok else None,
            page_count=result.page_count if result.ok else None,
        )

    return manifest


@router.get("/presentations/{slug}/download")
async def download_presentation(slug: str):
    """Download a verified presentation PDF."""
    file_path = _verified_path(slug)
    filename = file_path.name

    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/presentations/{slug}/stream")
async def stream_presentation(slug: str):
    """
    Stream a verified presentation PDF inline, honouring HTTP Range requests.

    The in-browser viewer fetches only the pages the visitor actually looks at,
    which is what keeps a 24 MB deck usable over exhibition Wi-Fi. Starlette's
    FileResponse implements Range itself (206, suffix ranges, and 416 with
    `Content-Range: bytes */size`), so there is nothing to hand-roll here.
    """
    file_path = _verified_path(slug)

    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        headers={"Accept-Ranges": "bytes"},
    )


# --------------------------------------------------------------------------
# Leads, analytics, chat
# --------------------------------------------------------------------------

@router.post("/leads", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_LEADS)
async def create_lead(
    request: Request,
    response: Response,
    payload: LeadCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle Request Demo submissions and persist the lead.

    Includes low-friction honeypot spam protection.
    """
    if payload.honeypot and payload.honeypot.strip():
        # No email address in the log line: a lead's contact details are personal
        # data and belong in the database, not in application logs that get
        # shipped, tailed and pasted into reports.
        logger.warning("Discarded a lead submission that tripped the honeypot.")
        return LeadResponse(
            success=True,
            message="Thank you. Your request has been received.",
        )

    try:
        new_lead = Lead(
            name=payload.name.strip(),
            company=payload.company.strip(),
            business_email=str(payload.business_email).strip().lower(),
            interest=payload.interest.strip().lower(),
            message=payload.message.strip() if payload.message and payload.message.strip() else None,
            notification_status="pending",
            notification_attempts=0,
        )
        db.add(new_lead)
        await db.commit()
        await db.refresh(new_lead)

        # Opaque id and non-identifying interest only.
        logger.info("Lead registered: id=%s interest=%s", new_lead.id, new_lead.interest)

        return LeadResponse(
            success=True,
            message="Thank you. Your request has been received. Our team will contact you shortly.",
            id=new_lead.id,
        )
    except Exception as e:
        await db.rollback()
        logger.error("Failed to save lead: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit lead request. Please try again later.",
        )


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_EVENTS)
async def record_event(
    request: Request,
    response: Response,
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
):
    """First-party, privacy-conscious analytics."""
    try:
        event = AnalyticsEvent(
            session_id=payload.session_id.strip(),
            event_name=payload.event_name.strip(),
            product=payload.product.strip() if payload.product else None,
            metadata_json=payload.metadata,
        )
        db.add(event)
        await db.commit()
        return EventResponse(success=True)
    except Exception as e:
        await db.rollback()
        logger.error("Failed to record analytics event: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record analytics event.",
        )


@router.post("/chat", response_model=ChatResponse)
@limiter.limit(settings.RATE_LIMIT_CHAT)
async def chat_endpoint(
    request: Request,
    response: Response,
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    CASPEL AI conversational RAG endpoint.

    A provider, network, auth or quota failure leaves here as 503 — never as a
    200 carrying an apology in the `answer` field. The browser can then offer a
    retry instead of showing an outage to a visitor as though it were CASPEL's
    answer, and the exchange is not recorded as an answered question.
    """
    try:
        return await rag_service.ask(
            db=db,
            session_id=payload.session_id,
            question=payload.message,
            ui_locale=payload.ui_locale,
        )
    except RagError as e:
        # No question text in the log line.
        logger.error("CASPEL AI could not answer: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CASPEL AI is temporarily unavailable. Please try again in a moment.",
        )
    except Exception as e:
        await db.rollback()
        logger.error("Unexpected failure in chat processing: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CASPEL AI is temporarily unavailable. Please try again in a moment.",
        )
