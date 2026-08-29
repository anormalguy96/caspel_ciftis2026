# CASPEL CIFTIS 2026 — Digital Presentation Hub

A production-shaped, Linux-first, self-hosted enterprise platform designed for CASPEL's physical exhibition stand at **CIFTIS 2026** (China International Fair for Trade in Services) in Beijing, China.

---

## Architecture Overview

The system consists of three major tiers:

1. **Page A — Exhibition Display / Kiosk (`{base}display`)**: A still, legible booth screen that reveals a locally generated QR code on tap and returns to rest by itself. Deliberately not animated — a looping screen nobody is touching is noise on the stand.
2. **Page B — Mobile Landing Page (`{base}`)**: Mobile-first digital presentation hub with 4 core product cards (*Caspel Corporate*, *Caspel ERP*, *Caspel PMS*, *IRISSEA*), in-browser PDF viewing, PDF downloads, and lead capture.
3. **CASPEL AI (`{base}api/chat`)**: RAG assistant over PostgreSQL `pgvector` retrieval and Google Gemini, grounded strictly in the approved decks and citing the slide it answered from. A provider failure returns HTTP 503 — never an apology wrapped in a 200.

Routes are relative to the configured base path (see *Deployment modes*): `{base}` is `/` on a dedicated subdomain and `/ciftis/` beneath the corporate site.

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
| `TRUSTED_PROXY_COUNT` | Proxies in front of the app; the rate limiter reads that entry of `X-Forwarded-For`, so a client cannot forge its own identity | `1` |
| `VITE_APP_BASE_PATH` | Where the SPA is mounted: `/` for a dedicated subdomain, `/ciftis/` beneath the corporate site | `/` |
| `VITE_PUBLIC_URL` | **Required.** The absolute public address, baked in at build time for canonical, Open Graph and the QR code. The build **fails** if it is missing, loopback, non-https, or disagrees with `VITE_APP_BASE_PATH` | *(none)* |
| `VITE_DISPLAY_RESET_SECONDS`| Kiosk inactivity reset timeout (seconds)| `25` |

### Interface language

The hub ships in English and Simplified Chinese. Both locale resources are
bundled into the build; nothing is fetched at runtime and no translation
service is contacted.

The language is chosen, highest precedence first:

1. a stored choice from the header's language control (`caspel_ciftis_locale`);
2. the browser's own `navigator.languages`, in the order the visitor set them
   (`zh`, `zh-CN` and `zh-Hans` resolve to Simplified Chinese; Traditional
   Chinese deliberately does not, and falls through);
3. English.

Switching language updates the page live, without a reload, and rewrites
`<html lang>` so assistive technology announces the right language.

> The Simplified Chinese copy is machine-drafted and **has not yet had fluent
> human review**. Treat that review as outstanding before production.

### CASPEL AI language behaviour

The assistant answers in the language the visitor used. Resolution happens on
the server, before the model is called:

1. an explicit request in the message ("answer in Chinese", "请用英文回答") wins,
   whatever language it is written in;
2. otherwise the language the question is clearly written in — English,
   Simplified Chinese or Azerbaijani;
3. for input too short to classify ("PMS"), the browser's UI locale is used as
   a hint;
4. otherwise English.

The UI locale is only ever a tie-breaker. An English question asked in a
Chinese interface is answered in English.

Citations are owned by the server. Retrieved records are labelled `SOURCE_1`,
`SOURCE_2`, … and the model may reference only those identifiers; document
titles and page numbers are then filled in from the server's own copy. An
identifier the model invents resolves to nothing and is dropped, so a
fabricated page number cannot reach a visitor. When retrieval finds nothing,
a reviewed refusal is returned in the resolved language and the provider is
not called at all.

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

## Deployment modes

The hub supports two public addresses, selected at build time — no source edit:

| Mode | Public URL | `VITE_APP_BASE_PATH` | `VITE_PUBLIC_URL` | Reverse proxy |
| :--- | :--- | :--- | :--- | :--- |
| A — subdomain | `https://ciftis.caspel.com/` | `/` | `https://ciftis.caspel.com` | [`deploy/nginx/caspel-ciftis.conf`](deploy/nginx/caspel-ciftis.conf) — own vhost |
| B — corporate path | `https://caspel.com/ciftis/` | `/ciftis/` | `https://caspel.com/ciftis` | [`deploy/nginx/caspel-com-ciftis-snippet.conf`](deploy/nginx/caspel-com-ciftis-snippet.conf) — merged into the existing vhost |

Only one mode is served per deployment. Mode A needs DNS and a certificate for
`ciftis.caspel.com`; Mode B reuses the existing `caspel.com` DNS and certificate
but needs access to the corporate reverse proxy. **Choose before building** —
the values are inlined into the bundle and the QR code cannot be recalled.

## Local Access URLs

- **Page B — Mobile Presentation Hub**: http://localhost:8080/
- **Page A — Exhibition Display / Kiosk**: http://localhost:8080/display
- **API docs (Swagger)**: `http://localhost:8080/docs` — served only when `APP_ENV` is not `production`.

Full deployment procedure: [deploy/RUNBOOK.md](deploy/RUNBOOK.md).
