from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class LeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Full name")
    company: str = Field(..., min_length=1, max_length=255, description="Company name")
    business_email: EmailStr = Field(..., max_length=255, description="Corporate email address")
    interest: str = Field(..., description="Solution of interest")
    message: Optional[str] = Field(None, max_length=2000, description="Optional custom request message or notes from company representative")
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


class ChatCapabilitiesResponse(BaseModel):
    """What the chat surface can do on *this* deployment.

    The browser has to choose a delivery path before it sends a question, and
    the only honest source for that is the server. Without this the client had
    to guess, and it guessed by attempting the streaming route and treating a
    404 as the answer -- which meant every visitor question on a
    default-configured deployment paid for a failed request first.

    Exactly one boolean is disclosed, and it is not a secret: whether streaming
    answers are available is already observable by anyone who sends one
    request. Nothing about the environment, the models, the corpus or the
    database appears here. See HealthResponse for the same reasoning applied to
    liveness.
    """

    streaming: bool


class ChatSource(BaseModel):
    """One citation, entirely server-owned.

    `slug` is the presentation-registry key, not something the model wrote. It
    is what lets the client build a deep link to the exact cited page without
    the server ever handing out a URL or a filesystem path -- a model-authored
    URL is the one thing a grounded citation must never contain.

    A source is only emitted when its slug is registered and its page is inside
    that document's real page count, so a link built from these fields cannot
    point at a document that does not exist or a page that is not there.
    """

    document: str
    product: Optional[str] = None
    page: int
    #: Presentation registry slug, e.g. "caspel" or "erp".
    slug: Optional[str] = None
    #: Retrieval similarity. Internal signal, not shown to visitors.
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


class TranscriptionResponse(BaseModel):
    """Just the text. No confidence, no language guess, no provider detail."""

    text: str
