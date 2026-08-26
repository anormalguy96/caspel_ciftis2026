# CASPEL CIFTIS 2026 — Digital Presentation Hub

A production-shaped, Linux-first, self-hosted enterprise platform designed for CASPEL's physical exhibition stand at **CIFTIS 2026** (China International Fair for Trade in Services) in Beijing, China.

---

## Architecture Overview

The system consists of three major tiers:

1. **Page A — Exhibition Display / Kiosk (`/ciftis/display`)**: A still, legible booth screen that reveals a locally generated QR code on tap and returns to rest by itself. Deliberately not animated — a looping screen nobody is touching is noise on the stand.
2. **Page B — Mobile Landing Page (`/ciftis`)**: Mobile-first digital presentation hub with 4 core product cards (*Caspel Corporate*, *Caspel ERP*, *Caspel PMS*, *IRISSEA*), in-browser PDF viewing, PDF downloads, and lead capture.
3. **CASPEL AI (`/api/chat`)**: RAG assistant over PostgreSQL `pgvector` retrieval and Google Gemini, grounded strictly in the approved decks and citing the slide it answered from. A provider failure returns HTTP 503 — never an apology wrapped in a 200.

There are deliberately **no admin and no status pages**. This site is reachable by QR code from a public exhibition hall, so it carries no login form and no operational telemetry screen. Leads are read from the database; readiness is read from `/api/ready`.

### Presentation integrity

A deck is published only if the file on disk is byte-for-byte the approved one: exact size, exact SHA256, a successful PDF parse, and the exact approved page count, all registered in [`backend/app/core/presentations.py`](backend/app/core/presentations.py). A recompressed, truncated or substituted file is refused rather than served under a CASPEL product name.

| Deck | Pages | State |
| :--- | :--- | :--- |
| CASPEL Corporate | 24 | registered and published |
| CASPEL ERP | 41 | registered and published |
| CASPEL PMS | — | awaiting a genuine client file |
| IRISSEA LRIT | — | awaiting a genuine client file |

---

## Linux CLI Development Workflow

> **Note**: All commands must be executed using Linux/WSL/Ubuntu bash.

### 1. Prerequisites

Ensure the following tools are installed in your Linux/WSL environment:

```bash
docker --version
docker compose version
node -v
npm -v
python3 --version
```

### 2. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `APP_ENV` | Application environment. `production` refuses to start unless every value below is production-ready | `development` |
| `APP_HTTP_PORT` | Public HTTP port exposed by Nginx | `8080` |
| `POSTGRES_DB` | PostgreSQL database name | `ciftis` |
| `POSTGRES_USER` | PostgreSQL user | `ciftis` |
| `POSTGRES_PASSWORD` | PostgreSQL password; required, with no source-controlled default | *(none)* |
| `GEMINI_API_KEY` | Server-side Gemini API key; required for CASPEL AI | *(none)* |
| `GEMINI_CHAT_MODEL` | Chat generation model. Environment-selected; no automatic fallback, so a failure on it is reported as an outage rather than answered by a substitute | `gemini-3.5-flash-lite` |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `gemini-embedding-2` |
| `ALLOW_MOCK_RAG` | Local development only. `/api/ready` refuses to report ready while true | `false` |
| `TRUSTED_PROXY_COUNT` | Proxies in front of the app; the rate limiter reads that entry of `X-Forwarded-For`, so a client cannot forge its own identity | `1` |
| `VITE_PUBLIC_SITE_URL` | **Required.** The real public origin, baked in at build time for canonical and Open Graph tags. The production build **fails** on a missing, loopback or non-https value | *(none)* |
| `VITE_PUBLIC_CIFTIS_URL` | Target URL encoded in the kiosk QR code | *(site URL)* + `/ciftis` |
| `VITE_DISPLAY_RESET_SECONDS`| Kiosk inactivity reset timeout (seconds)| `25` |

---

## Running with Docker Compose

### Start the full stack (Nginx + FastAPI + PostgreSQL + pgvector):

```bash
docker compose up -d --build
```

### Check service status & health:

```bash
docker compose ps
```

### View container logs:

```bash
# All services
docker compose logs -f

# Backend only
docker compose logs -f backend

# Nginx only
docker compose logs -f nginx
```

### Stop the stack:

```bash
docker compose down
```

---

## Database Migrations (Alembic)

Alembic is the sole owner of the schema. `/api/ready` verifies the `vector` extension and the corpus at runtime; it never creates anything.

```bash
# Run migrations inside the backend container
docker compose exec backend alembic upgrade head

# Or locally within a Python virtualenv:
cd backend
alembic upgrade head
```

---

## Knowledge Ingestion (RAG Pipeline)

Ingestion uses an explicit allowlist of the approved decks and verifies each file against its SHA256 before reading a byte of it. It never globs `*.pdf`.

```bash
# Inside the container:
docker compose exec -T backend python scripts/ingest_documents.py

# Report exactly what is indexed, changing nothing:
docker compose exec -T backend python scripts/ingest_documents.py --report-only
```

Clearing the corpus is guarded: `--clear` additionally requires
`--confirm-clear-corpus` and `--backup <path to a verified pg_dump>`.

---

## Running Automated Tests

### Backend Tests (pytest):

```bash
docker compose exec -T backend python -m pytest -q

# Or locally, with the dev dependencies:
cd backend && pip install -r requirements-dev.txt && python -m pytest -q
```

### Frontend Tests (vitest):

```bash
cd frontend
npm ci        # Node 22. Never `npm install` — the lockfile is the contract.
npm run test
```

---

## API Smoke Tests (curl)

### Health Check:
```bash
curl -i http://localhost:8080/api/health
```

### Readiness Check:
```bash
curl -i http://localhost:8080/api/ready
```

Ready means all five of: PostgreSQL reachable, pgvector installed, a live Gemini
provider configured, mock mode off, and every approved deck represented in the
database by its source SHA256 with non-null embeddings. Anything less is a 503.

### Submit a Lead (Request Demo):
```bash
curl -i \
  -X POST \
  http://localhost:8080/api/leads \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Emin Mammadov",
    "company": "CASPEL Partner",
    "business_email": "emin@example.com",
    "interest": "erp"
  }'
```

### Track an Analytics Event:
```bash
curl -i \
  -X POST \
  http://localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "cli_test_session",
    "event_name": "ERP_CLICK",
    "product": "erp"
  }'
```

### Ask CASPEL AI:
```bash
curl -i \
  -X POST \
  http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "cli_test_session",
    "message": "What is CASPEL ERP?"
  }'
```

---

## Local Access URLs

- **Page B — Mobile Presentation Hub**: [http://localhost:8080/ciftis](http://localhost:8080/ciftis)
- **Page A — Exhibition Display / Kiosk**: [http://localhost:8080/ciftis/display](http://localhost:8080/ciftis/display)
- **API docs (Swagger)**: `http://localhost:8080/docs` — served only when `APP_ENV` is not `production`.

Full deployment procedure: [deploy/RUNBOOK.md](deploy/RUNBOOK.md).
