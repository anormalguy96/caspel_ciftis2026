# CASPEL CIFTIS 2026 — Digital Presentation Hub

A production-shaped, Linux-first, self-hosted enterprise platform designed for CASPEL's physical exhibition stand at **CIFTIS 2026** (China International Fair for Trade in Services) in Beijing, China.

---

## Architecture Overview

The system consists of three major tiers:

1. **Page A — Exhibition Display / Kiosk (`/ciftis/display`)**: Touch-interactive kiosk with continuous animation loop, visitor tap interaction, local QR generation, and configurable auto-reset.
2. **Page B — Mobile Landing Page (`/ciftis`)**: Mobile-first digital presentation hub with 4 core product cards (*Caspel Corporate*, *Caspel ERP*, *Caspel PMS*, *IRISSEA*), in-browser PDF viewing, PDF downloads, and lead capture.
3. **CASPEL AI (`/api/chat`)**: RAG-based enterprise assistant powered by PostgreSQL `pgvector` semantic retrieval and Google Gemini with strict anti-hallucination grounding.

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
| `APP_ENV` | Application environment | `development` |
| `APP_HTTP_PORT` | Public HTTP port exposed by Nginx | `8080` |
| `POSTGRES_DB` | PostgreSQL database name | `ciftis` |
| `POSTGRES_USER` | PostgreSQL user | `ciftis` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `ciftis_secret_password_2026` |
| `GEMINI_API_KEY` | Server-side Gemini API key | *(Optional for dev mock)* |
| `GEMINI_CHAT_MODEL` | Gemini LLM model | `gemini-2.0-flash` |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `text-embedding-004` |
| `VITE_PUBLIC_CIFTIS_URL` | Target URL encoded in Kiosk QR code | `http://localhost:8080/ciftis` |
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

Database tables and the `vector` extension are automatically verified on backend startup. To run or inspect Alembic migrations manually:

```bash
# Run migrations inside the backend container
docker compose exec backend alembic upgrade head

# Or locally within a Python virtualenv:
cd backend
alembic upgrade head
```

---

## Knowledge Ingestion (RAG Pipeline)

To ingest PDF presentations or populate the approved synthetic knowledge base into `pgvector`:

```bash
# Inside the container:
docker compose exec backend python scripts/ingest_documents.py

# Or locally:
cd backend
python3 scripts/ingest_documents.py
```

---

## Running Automated Tests

### Backend Tests (pytest):

```bash
# Inside the container:
docker compose exec backend pytest -v

# Or locally:
cd backend
pytest -v
```

### Frontend Tests (vitest):

```bash
cd frontend
npm run test
```

---

## API Smoke Tests (curl)

### Health Check:
```bash
curl -i http://localhost:8080/api/health
```

### Readiness Check (DB + pgvector):
```bash
curl -i http://localhost:8080/api/ready
```

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
- **Interactive API Documentation (Swagger)**: [http://localhost:8080/docs](http://localhost:8080/docs)
