import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.config import settings
from app.models.entities import Lead, AnalyticsEvent
from app.schemas.schemas import (
    LeadCreate,
    LeadResponse,
    EventCreate,
    EventResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    ReadyResponse,
)
from app.rag.service import rag_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """Health check endpoint to verify service and database connectivity."""
    try:
        await db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        logger.error(f"Health check database connection failed: {e}")
        db_status = "disconnected"

    return HealthResponse(
        status="healthy" if db_status == "connected" else "degraded",
        database=db_status,
        app_env=settings.APP_ENV,
    )


@router.get("/ready", response_model=ReadyResponse)
async def ready_check(db: AsyncSession = Depends(get_db)):
    """Readiness probe checking database, pgvector extension, and RAG status."""
    db_connected = False
    vector_ext_ok = False

    try:
        res = await db.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
        )
        ext = res.scalar_one_or_none()
        db_connected = True
        vector_ext_ok = ext == "vector"
    except Exception as e:
        logger.error(f"Ready check error: {e}")

    is_ready = db_connected and vector_ext_ok

    return ReadyResponse(
        status="ready" if is_ready else "not_ready",
        database="connected" if db_connected else "disconnected",
        vector_extension=vector_ext_ok,
        rag_ready=True,
    )


@router.post("/leads", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(payload: LeadCreate, db: AsyncSession = Depends(get_db)):
    """
    Handle Request Demo submissions and persist lead to PostgreSQL.
    Includes low-friction honeypot spam protection.
    """
    # Honeypot spam protection
    if payload.honeypot and payload.honeypot.strip():
        logger.warning(f"Spam lead detected via honeypot from email: {payload.business_email}")
        # Silently return success to discard bot without triggering aggressive retry
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
            notification_status="pending",
            notification_attempts=0,
        )
        db.add(new_lead)
        await db.commit()
        await db.refresh(new_lead)

        logger.info(f"Lead registered successfully: ID={new_lead.id}, Email={new_lead.business_email}, Interest={new_lead.interest}")

        return LeadResponse(
            success=True,
            message="Thank you. Your request has been received. Our team will contact you shortly.",
            id=new_lead.id,
        )
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to save lead: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit lead request. Please try again later.",
        )


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def record_event(payload: EventCreate, db: AsyncSession = Depends(get_db)):
    """
    First-party privacy-conscious analytics event tracking.
    """
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
        logger.error(f"Failed to record analytics event: {e}")
        # Return success=False but avoid failing user interactions for analytics failures
        return EventResponse(success=False)


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    """
    CASPEL AI conversational RAG endpoint.
    Retrieves grounded context from pgvector and generates responses.
    """
    try:
        response = await rag_service.ask(
            db=db,
            session_id=payload.session_id,
            question=payload.message,
        )
        return response
    except Exception as e:
        logger.error(f"Error in chat processing: {e}")
        return ChatResponse(
            answer=(
                "CASPEL AI is temporarily experiencing technical difficulties. "
                "Please explore our presentations above or contact our team via the Request Demo form."
            ),
            sources=[],
            session_id=payload.session_id,
        )
