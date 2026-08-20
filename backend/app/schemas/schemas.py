from datetime import datetime
from typing import Optional, List, Dict, Any
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
    status: str
    database: str
    app_env: str


class ReadyResponse(BaseModel):
    status: str
    database: str
    vector_extension: bool
    rag_ready: bool
