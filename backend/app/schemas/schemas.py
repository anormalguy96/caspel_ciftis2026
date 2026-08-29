from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class LeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Full name")
    company: str = Field(..., min_length=1, max_length=255, description="Company name")
    business_email: EmailStr = Field(..., max_length=255, description="Corporate email address")
    interest: str = Field(..., description="Solution of interest")
    honeypot: Optional[str] = Field(None, max_length=100, description="Spam protection field (should be empty)")

    @field_validator("interest")
    @classmethod
    def validate_interest(cls, v: str) -> str:
        allowed = {"erp", "pms", "irissea", "general", "caspel"}
        clean_v = v.strip().lower()
        if clean_v not in allowed:
            raise ValueError(f"Interest must be one of: {', '.join(allowed)}")
        return clean_v


class LeadResponse(BaseModel):
    success: bool = True
    message: str = "Thank you. Your request has been received. Our team will contact you shortly."
    id: Optional[int] = None


class EventCreate(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=100)
    event_name: str = Field(..., min_length=1, max_length=100)
    product: Optional[str] = Field(None, max_length=50)
    metadata: Optional[Dict[str, Any]] = None


class EventResponse(BaseModel):
    success: bool = True


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=100)
    message: str = Field(..., min_length=1, max_length=1000)
    #: Which language the browser UI is displaying. A hint only: the visitor's
    #: own question decides the response language, and this breaks the tie when
    #: the message is too short to classify ("PMS?"). Constrained so an
    #: arbitrary string cannot be injected into the generation instruction.
    ui_locale: Optional[Literal["en", "zh-CN"]] = None


class ChatSource(BaseModel):
    document: str
    product: Optional[str] = None
    page: int
    score: Optional[float] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource] = []
    session_id: str


class HealthResponse(BaseModel):
    """
    Deliberately minimal.

    /api/health is reachable by anyone who can reach the site, so it reports
    liveness and nothing else. Environment name, model names, database topology
    and corpus statistics are operational detail; publishing them to the public
    internet hands an attacker a free inventory of the deployment.
    """

    status: Literal["healthy", "degraded"]


class ReadyChecks(BaseModel):
    """Pass/fail per dependency. Booleans only, no names, versions or counts."""

    database: bool
    vector_extension: bool
    live_ai_provider: bool
    mock_mode_disabled: bool
    approved_corpus: bool


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadyChecks


class PresentationItem(BaseModel):
    slug: str
    name: str
    available: bool
    download_filename: str
    size_bytes: Optional[int] = None
    page_count: Optional[int] = None
