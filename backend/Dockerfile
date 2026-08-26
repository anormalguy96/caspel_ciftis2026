FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# tesseract-ocr backs the OCR path for image-only presentation slides. Without
# it those pages are skipped rather than indexed — and never invented.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# requirements.txt is a fully pinned, resolved set. It is installed rather than
# requirements.in so that rebuilding this image next month produces the same
# packages the suite was verified against, instead of whatever is newest that
# day. --no-deps would be stricter still, but the pinned set is complete and
# letting pip verify the graph catches a bad regeneration.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user. /data/presentations is mounted read-only, so
# the app needs no write access to anything it serves.
RUN useradd --create-home --uid 10001 caspel \
    && chown -R caspel:caspel /app
USER caspel

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# Two workers: enough for booth traffic, and low enough to keep the Postgres
# connection pool small on a modest VPS.
#
# --forwarded-allow-ips stays "*" because the nginx container gets a dynamic
# address on the compose network. That is safe only because of two other
# facts, both enforced elsewhere: the backend port is never published to the
# host (docker-compose uses expose, not ports), so the only possible peers are
# containers on that network; and nginx OVERWRITES X-Forwarded-For rather than
# appending to it, so a client cannot smuggle an address through. Change
# either of those and this flag has to be narrowed.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
