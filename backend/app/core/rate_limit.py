"""
Request rate limiting.

/api/leads, /api/events and /api/chat are unauthenticated by design: a visitor
scans a QR code and uses them immediately. /api/chat in particular spends Gemini
tokens per call, so without a limit a single script can run up cost and flood
the database. These ceilings sit far above human use.
"""
import ipaddress
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.core.config import settings

logger = logging.getLogger(__name__)


def client_key(request: Request) -> str:
    """
    Identify the caller for rate-limiting purposes.

    X-Forwarded-For is a client-controlled header for every hop the request has
    not yet passed through. Trusting its FIRST entry, as this used to, means any
    caller can send `X-Forwarded-For: <random>` and get a fresh quota on every
    request, which makes the limit decorative.

    nginx appends the peer address, so with N trusted proxies in front the
    rightmost N entries were written by infrastructure we control, and the
    Nth-from-the-right is the address the outermost trusted proxy actually saw.
    Anything further left was supplied by the client and is ignored.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        trusted = max(1, settings.TRUSTED_PROXY_COUNT)
        if len(parts) >= trusted:
            candidate = parts[-trusted]
            try:
                # Reject anything that is not a valid address before it becomes
                # an unbounded-cardinality key in the limiter's store.
                return str(ipaddress.ip_address(candidate))
            except ValueError:
                logger.warning("Ignoring malformed X-Forwarded-For entry from proxy chain")

    return get_remote_address(request)


limiter = Limiter(key_func=client_key, headers_enabled=True)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    logger.warning("Rate limit hit on %s", request.url.path)
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please wait a moment and try again."},
    )


def install_rate_limiting(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.add_middleware(SlowAPIMiddleware)
