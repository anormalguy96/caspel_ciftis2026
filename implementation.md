# CASPEL CIFTIS 2026 — Phase 1 Implementation Task

You are acting as a senior full-stack engineer, AI/RAG engineer, DevOps engineer, and technical reviewer.

Your task is to **implement Phase 1 of the CASPEL CIFTIS 2026 project**, not merely describe how it could be implemented.

You must inspect the existing workspace, create or modify the project files, install dependencies where appropriate, run the application, run tests, verify the architecture, fix errors you encounter, and leave the repository in a clean and reproducible state.

Do not stop after scaffolding or giving recommendations.

---

# 1. Project Context

CASPEL will participate in **CIFTIS 2026 in Beijing, China**.

The system is intended for CASPEL's physical exhibition stand.

There are three major logical components:

1. **Page A — Exhibition Display / Kiosk Page**
2. **Page B — Mobile Landing Page**
3. **CASPEL AI — RAG-based chatbot**

The final production system will eventually be hosted on a CASPEL-controlled Linux server, likely under a URL similar to:

```text
https://caspel.com/ciftis
```

Production routing is not yet finalized.

The current task is **Phase 1**, which must establish a reliable production-shaped local foundation.

---

# 2. CRITICAL TERMINAL REQUIREMENT

This requirement is mandatory.

## DO NOT use:

```text
Windows CMD
PowerShell
cmd.exe
powershell.exe
```

for project operations, dependency installation, server management, Docker commands, filesystem operations, build commands, database commands, Git operations, or testing.

The company works primarily with Linux CLI.

Use:

```text
Linux
Ubuntu
WSL
bash
```

commands.

Assume the intended local development environment is:

```text
Windows host
    ↓
WSL Ubuntu
    ↓
Linux CLI
```

All serious terminal operations must use Linux/bash syntax.

Examples:

```bash
pwd
ls -la
find .
mkdir -p
cp
mv
rm
grep
curl
git
docker
docker compose
npm
python3
pip
```

If you detect that the current terminal is Windows CMD or PowerShell, do not start implementing the project using Windows commands.

Instead, clearly indicate that the development terminal should be WSL/Ubuntu and continue using Linux-compatible commands.

All commands shown in documentation must also use Linux/bash syntax.

---

# 3. Phase 1 Objective

Phase 1 is intended to establish the **technical foundation and one working end-to-end vertical slice**.

At the end of Phase 1, the project should have:

* a clean repository structure;
* React/Vite/TypeScript frontend;
* FastAPI backend;
* PostgreSQL database;
* pgvector extension;
* Nginx;
* Docker Compose;
* Linux-first development workflow;
* Page A skeleton;
* Page B skeleton;
* product routing foundation;
* database-backed Request Demo foundation;
* first-party analytics foundation;
* database structure for AI conversations;
* RAG ingestion foundation;
* Gemini integration abstraction;
* one minimal RAG flow that can be tested;
* health checks;
* migrations;
* test suite;
* proper environment configuration;
* documentation;
* reproducible startup using Linux CLI.

Do not spend excessive time polishing animations or final visual design during Phase 1.

Architecture correctness and maintainability are more important at this stage.

---

# 4. Do Not Overengineer

Do NOT introduce the following unless there is a demonstrated Phase 1 requirement:

```text
Kubernetes
Kafka
RabbitMQ
Celery
Redis
microservices
Pinecone
Weaviate
Qdrant
Elasticsearch
Supabase hosted database
Firebase
serverless architecture
multiple backend services
```

This project has a short deadline.

Prefer:

```text
React/Vite
FastAPI
PostgreSQL
pgvector
Nginx
Docker Compose
```

Keep the architecture understandable by another CASPEL engineer.

---

# 5. Desired Architecture

Use approximately this architecture:

```text
                         CLIENT
                           │
                           │ HTTPS / HTTP locally
                           ▼
                    ┌──────────────┐
                    │    NGINX     │
                    └──────┬───────┘
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
          Frontend        PDFs         /api/*
                                             │
                                             ▼
                                      ┌─────────────┐
                                      │   FastAPI   │
                                      └──────┬──────┘
                                             │
                         ┌───────────────────┼──────────────────┐
                         │                   │                  │
                         ▼                   ▼                  ▼
                    PostgreSQL           pgvector           Gemini API
                         │
                         ├── leads
                         ├── analytics
                         ├── chat sessions
                         ├── chat messages
                         ├── documents
                         └── document chunks
```

---

# 6. Repository Structure

Prefer a maintainable structure similar to:

```text
caspel-ciftis/
│
├── frontend/
│   ├── public/
│   │   ├── assets/
│   │   ├── presentations/
│   │   └── videos/
│   │
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── config/
│   │   ├── features/
│   │   │   ├── display/
│   │   │   ├── products/
│   │   │   ├── presentations/
│   │   │   ├── demo/
│   │   │   └── caspel-ai/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── styles/
│   │   ├── types/
│   │   └── locales/
│   │
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── rag/
│   │
│   ├── scripts/
│   │   └── ingest_documents.py
│   │
│   ├── tests/
│   ├── alembic/
│   ├── alembic.ini
│   └── requirements.txt
│
├── data/
│   └── presentations/
│
├── nginx/
│   └── nginx.conf
│
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── ARCHITECTURE.md
└── PHASE1_REPORT.md
```

You may improve this layout if there is a strong engineering reason, but keep the separation clear.

---

# 7. Frontend Technology

Use:

```text
React
Vite
TypeScript
React Router
```

Do not introduce Next.js unless there is a compelling technical reason.

The website must remain lightweight.

Avoid unnecessary JavaScript dependencies.

Do not use external CDNs for essential runtime assets.

Do not depend on Google Fonts.

Use:

* local fonts if CASPEL brand fonts are available;
* otherwise safe system-font fallbacks.

---

# 8. Page B — Mobile Landing Page

The main mobile URL should conceptually be:

```text
/ciftis
```

The primary use case is:

```text
QR scan
→ smartphone
→ landing page
```

The mobile page must eventually present these four primary cards:

```text
Caspel Presentation
Corporate Presentation
```

```text
Caspel ERP
Enterprise Resource Planning
```

```text
Caspel PMS
Procurement Management System
```

```text
IRISSEA
LRIT Solution
```

Create the Phase 1 UI skeleton for them.

Do not invent unapproved detailed marketing claims.

If actual descriptions are not available, use clearly marked configuration placeholders.

---

# 9. Page B Information Hierarchy

Maintain this order:

```text
CASPEL brand
    ↓
Main solutions
    ↓
Presentation access
    ↓
CASPEL AI
    ↓
Request Demo
    ↓
Corporate contact/footer
```

CASPEL AI must complement the page rather than dominate it.

---

# 10. Page B Hero

The hero should support short English messaging such as:

```text
Explore Caspel Solutions
```

Do not place long corporate paragraphs in the hero.

Phase 1 should establish the layout and component system.

---

# 11. Product Routing

Product pages must be configuration-driven.

Routes may look like:

```text
/ciftis/product/caspel
/ciftis/product/erp
/ciftis/product/pms
/ciftis/product/irissea
```

Avoid logic such as:

```typescript
if (product === "erp") ...
else if (product === "pms") ...
```

spread throughout components.

Create a central configuration structure.

Example concept:

```typescript
type ProductConfig = {
  slug: string;
  name: string;
  descriptor: string;
  description?: string;
  coverUrl?: string;
  presentationUrl?: string;
  downloadFilename: string;
};
```

---

# 12. Product Configuration

Create centralized data similar to:

```typescript
{
  slug: "erp",
  name: "Caspel ERP",
  descriptor: "Enterprise Resource Planning",
  presentationUrl: "/presentations/CASPEL_ERP_Presentation.pdf",
  downloadFilename: "CASPEL_ERP_Presentation.pdf"
}
```

Descriptions and real asset paths must be easy to change.

A new PDF version must not require rewriting page components.

---

# 13. Future Internationalization

The current interface language is English only.

However, architecture must not prevent adding another language later.

Do NOT implement Chinese content now.

Prepare a simple localization structure such as:

```text
src/locales/
└── en.json
```

Avoid scattering hardcoded UI text throughout many components.

Do not introduce a huge i18n framework unless necessary.

---

# 14. Page A — Exhibition Display

Page A is not the same as Page B.

It is intended for a touch-capable exhibition display, likely landscape.

Suggested route:

```text
/ciftis/display
```

Expected behavior:

```text
fullscreen exhibition screen
        ↓
looping CASPEL animation/video
        ↓
visitor taps the screen
        ↓
QR overlay appears
        ↓
visitor scans QR
        ↓
mobile Page B opens
```

---

# 15. Page A Video

The video must be:

```text
self-hosted
autoplay
muted
loop
playsinline
```

Do NOT use:

```text
YouTube
Vimeo
third-party video embeds
```

If the actual CASPEL video is not yet available, provide a clean placeholder mechanism.

Do not download random placeholder video from the internet.

---

# 16. Page A Reset Behavior

A kiosk visitor may tap the screen and leave.

Therefore implement inactivity/reset behavior.

Example:

```text
video loop
   ↓
tap
   ↓
QR overlay
   ↓
20–30 seconds inactivity
   ↓
QR overlay closes
   ↓
video state resumes
```

Make timeout configurable.

For example:

```text
VITE_DISPLAY_RESET_SECONDS=25
```

---

# 17. Page A QR

The final URL is not confirmed.

Do not hardcode a production URL.

Use configuration.

For example:

```text
VITE_PUBLIC_CIFTIS_URL=http://localhost:8080/ciftis
```

In production this may later become:

```text
https://caspel.com/ciftis
```

Use a QR-generation library that works locally and does not call an external QR-generation API.

---

# 18. Mobile-First Requirements

Page B must be mobile-first.

At minimum design/test for widths:

```text
320px
360px
375px
390px
414px
430px
```

Also ensure it remains usable on:

```text
tablet
laptop
desktop
```

There must be:

* no horizontal scrolling;
* no clipped text;
* sufficiently large touch targets;
* responsive cards;
* readable typography.

---

# 19. Backend

Use:

```text
Python
FastAPI
Pydantic
SQLAlchemy
Alembic
```

Keep the backend as a single service.

Suggested API prefix:

```text
/api
```

At minimum create:

```text
GET /api/health
GET /api/ready
```

Phase 1 should also provide foundations for:

```text
POST /api/leads
POST /api/events
POST /api/chat
```

Prefer making the lead and event endpoints actually functional in Phase 1.

---

# 20. PostgreSQL

Use PostgreSQL as the project's primary data store.

Do not use Supabase hosted database for the main architecture.

Use a Dockerized PostgreSQL instance.

Prefer a pgvector-enabled image such as:

```text
pgvector/pgvector
```

with a stable PostgreSQL version.

Enable:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

using migrations or initialization logic.

---

# 21. Database Migrations

Use Alembic.

Do not depend on manually creating tables.

A fresh developer must be able to clone the project and create the schema reproducibly.

---

# 22. Initial Database Tables

Design clean SQLAlchemy models for at least:

## leads

Suggested fields:

```text
id
name
company
business_email
interest
created_at
notification_status
notification_attempts
```

Notification fields may remain unused during Phase 1.

---

## analytics_events

Suggested fields:

```text
id
session_id
event_name
product
metadata
created_at
```

Do not collect unnecessary personal information here.

---

## chat_sessions

Suggested fields:

```text
id
session_id
started_at
created_at
```

---

## chat_messages

Suggested fields:

```text
id
session_id
role
content
created_at
```

Roles may include:

```text
user
assistant
```

---

## documents

Suggested fields:

```text
id
name
source_type
source_path
product
created_at
updated_at
```

---

## document_chunks

Suggested fields:

```text
id
document_id
page_number
chunk_index
content
embedding
created_at
```

Use a pgvector column.

---

# 23. Leads API

Implement:

```text
POST /api/leads
```

Payload:

```json
{
  "name": "John Smith",
  "company": "Example Ltd",
  "business_email": "john@example.com",
  "interest": "erp"
}
```

Validate:

* required fields;
* reasonable maximum string lengths;
* valid email;
* allowed interest values.

Allowed interest values should include:

```text
erp
pms
irissea
general
```

Return a clean API response.

Do not expose internal database errors.

---

# 24. Request Demo UI

Create a basic functional Phase 1 form with:

```text
Name
Company
Business Email
Interested in
```

Options:

```text
Caspel ERP
Caspel PMS
IRISSEA
General / Partnership
```

Submit to:

```text
POST /api/leads
```

Show success confirmation after a successful database insert.

The eventual copy may be:

```text
Thank you. Your request has been received.
Our team will contact you shortly.
```

---

# 25. Microsoft Email Integration

CASPEL has reportedly moved away from traditional SMTP-based application email toward Microsoft infrastructure.

Do NOT implement legacy username/password SMTP.

Microsoft Graph may later be used for lead notifications.

However, the final CASPEL mail integration details are not yet known.

Therefore:

* create a clean notification service interface if useful;
* do not block lead creation on email;
* do not invent Microsoft credentials;
* do not require Graph for Phase 1 completion;
* document the future integration point.

A lead successfully written to PostgreSQL must count as a successful lead submission even if future notification delivery fails.

---

# 26. Analytics

Do NOT integrate Google Analytics as a critical dependency.

Create a first-party event endpoint:

```text
POST /api/events
```

Example:

```json
{
  "session_id": "...",
  "event_name": "ERP_CLICK",
  "product": "erp",
  "metadata": {}
}
```

Frontend should generate an anonymous session identifier.

Do not require user login.

Store events in PostgreSQL.

---

# 27. Initial Event Vocabulary

Prepare for events such as:

```text
DISPLAY_LOOP_VIEW
DISPLAY_TAP
QR_REVEAL

LANDING_OPEN

CORPORATE_CLICK
ERP_CLICK
PMS_CLICK
IRISSEA_CLICK

PRESENTATION_VIEW
PRESENTATION_DOWNLOAD

AI_OPEN
AI_QUESTION
AI_RESPONSE
AI_ERROR

DEMO_OPEN
FORM_SUBMIT
```

You do not need to fully instrument every event in Phase 1 if that would slow foundational work.

But define a consistent event model.

At minimum instrument:

```text
LANDING_OPEN
ERP_CLICK
PMS_CLICK
IRISSEA_CLICK
DEMO_OPEN
FORM_SUBMIT
```

if practical.

---

# 28. PDF Architecture

The final system contains four PDFs.

At least two known PDF sizes are approximately:

```text
23 MB
5 MB
```

Do not preload PDFs when the landing page opens.

Correct behavior:

```text
landing opens
→ no presentation PDF downloaded
→ visitor opens product
→ visitor selects View Presentation
→ selected PDF is loaded
```

PDF size still matters for cold-cache visitors.

Browser caching only helps later requests.

---

# 29. PDF Viewer

Prepare the project to use a self-hosted browser PDF viewer.

Prefer PDF.js or an equivalent locally bundled solution.

Do not use:

```text
Google Docs Viewer
third-party PDF viewer SaaS
external embed platform
```

Phase 1 may implement a basic viewer route if practical.

Suggested routes:

```text
/ciftis/presentation/corporate
/ciftis/presentation/erp
/ciftis/presentation/pms
/ciftis/presentation/irissea
```

The viewer architecture should eventually support:

* vertical scroll;
* mobile sizing;
* pinch/zoom where supported;
* navigation;
* Back/Home behavior.

---

# 30. PDF Downloads

Downloads should eventually expose standardized filenames:

```text
CASPEL_Corporate_Presentation.pdf
CASPEL_ERP_Presentation.pdf
CASPEL_PMS_Presentation.pdf
IRISSEA_LRIT_Presentation.pdf
```

Do not preload these files.

---

# 31. Static Asset Caching

Configure Nginx sensibly for static assets.

Use:

* ETag or equivalent;
* Cache-Control;
* byte-range support for PDFs where available;
* compression for relevant text assets.

Do not blindly set one-year immutable caching on files whose URL may remain unchanged while content changes.

Prefer versioned asset URLs or versioned filenames for long-lived immutable assets.

---

# 32. CASPEL AI

CASPEL AI is a RAG-based chatbot.

Its purpose is to answer exhibition visitors' questions about CASPEL and its solutions.

Known initial approved sources are expected to be:

```text
1. CASPEL Corporate Presentation PDF
2. CASPEL ERP Presentation PDF
3. CASPEL PMS Presentation PDF
4. IRISSEA Presentation PDF
```

The CASPEL website may later be included as an additional source.

Other FAQ/document sources may also be added later.

Do not assume they exist now.

---

# 33. RAG Principle

The pipeline should conceptually be:

```text
PDF
  ↓
text extraction
  ↓
semantic chunks
  ↓
embedding
  ↓
PostgreSQL + pgvector
```

Then:

```text
user question
  ↓
question embedding
  ↓
similarity search
  ↓
top relevant chunks
  ↓
Gemini + retrieved context
  ↓
grounded answer
```

---

# 34. PDF Extraction

Use a lightweight reliable Python PDF extraction library.

Prefer:

```text
PyMuPDF
```

unless the actual presentation structure makes another library clearly superior.

Preserve page numbers.

Page numbers are important because CASPEL AI should eventually be capable of showing sources such as:

```text
CASPEL ERP Presentation — page 14
```

---

# 35. Chunking Strategy

These are slide presentations, not ordinary books.

Do not automatically assume generic fixed 500-token chunking is optimal.

Prefer an initial strategy based around:

```text
one presentation page/slide ≈ one semantic unit
```

For a page with excessive text:

* split into smaller chunks.

For extremely small adjacent pages:

* merging may be considered if semantically appropriate.

Store:

```text
document
page number
chunk index
text
embedding
```

---

# 36. Gemini

The team lead will provide a working Gemini API key.

The key must exist only on the backend/server side.

Never expose the Gemini API key through:

```text
VITE_*
frontend JavaScript
HTML
browser requests
Git
```

Use environment variables.

Example:

```text
GEMINI_API_KEY=
GEMINI_CHAT_MODEL=
GEMINI_EMBEDDING_MODEL=
```

Keep model identifiers configurable.

If selecting defaults, verify compatibility with the currently installed/latest official Gemini SDK instead of scattering model names throughout the code.

Create a centralized Gemini provider/service.

---

# 37. RAG Provider Abstraction

Avoid tying all application logic directly to one SDK call.

Create clean responsibilities such as:

```text
EmbeddingService
RetrievalService
ChatGenerationService
RagService
```

Do not over-abstract into dozens of unnecessary interfaces.

Keep the code readable.

---

# 38. RAG Guardrails

The assistant must not invent CASPEL facts.

Prepare a grounding-oriented system prompt.

Conceptually:

```text
You are CASPEL AI, an assistant designed for CASPEL's CIFTIS 2026 exhibition presence.

Answer questions about CASPEL and its products using only the approved context supplied to you.

If the answer is not supported by the supplied context, say that the information is not available in the provided materials.

Do not invent:

clients
prices
partnerships
certifications
product capabilities
implementation details
company statistics
office locations
legal claims

When possible, reference the source presentation and page.
```

Do not hardcode unverified company facts.

---

# 39. RAG Source Metadata

Retrieved chunks should retain:

```text
document name
product
page number
chunk id
```

The API should be designed so the frontend can eventually display:

```text
Sources:
CASPEL ERP Presentation — p. 14
CASPEL Corporate Presentation — p. 6
```

---

# 40. Chat Persistence

The user wants conversation text to be stored in the database.

Implement the foundation for:

```text
chat_sessions
chat_messages
```

The `/api/chat` endpoint should, when enabled:

1. receive a session ID and question;
2. store the user message;
3. run RAG;
4. store the assistant response;
5. return the response and source metadata.

Do not store Gemini API keys or internal prompts in the chat tables.

---

# 41. CASPEL AI Frontend

Create a simple Phase 1 UI entry point.

Prefer:

```text
Ask CASPEL AI
```

as either:

* a floating button;
* or an AI CTA below the primary product section.

On mobile, a bottom-sheet/modal pattern is acceptable.

Do not let the chatbot visually overpower the product cards.

Phase 1 UI can be simple but must be architecturally clean.

---

# 42. Suggested Chat UI

Provide an initial state such as:

```text
CASPEL AI

Ask me about CASPEL and our solutions.

Suggested questions:
• What is CASPEL ERP?
• What is CASPEL PMS?
• What is IRISSEA?
```

Do not include suggested questions whose answers are not expected to exist in approved material.

---

# 43. RAG Phase 1 Vertical Slice

This is important.

Do not postpone all RAG work to a later phase.

Phase 1 must prove the architecture end to end.

If at least one real CASPEL PDF is available locally:

1. ingest one real PDF;
2. extract its pages;
3. generate embeddings;
4. store chunks in pgvector;
5. send one test question;
6. retrieve relevant chunks;
7. generate a grounded Gemini answer;
8. return source metadata.

If no real CASPEL PDF is currently available in the workspace:

* do NOT invent fake CASPEL company facts;
* create a clearly synthetic test document only for automated/local RAG verification;
* clearly label it as test data;
* make real PDF ingestion immediately usable when documents arrive.

---

# 44. Gemini Key Missing During Development

If `GEMINI_API_KEY` is not present:

Do not block the entire project.

Implement:

* proper environment validation;
* clear startup/log message;
* RAG service readiness state;
* testable retrieval/database logic;
* optionally a deterministic mock provider for automated tests only.

Do not pretend the real Gemini integration succeeded when no key exists.

When a real key is supplied, the project should be able to switch without architecture changes.

---

# 45. Avoid Live Website RAG for Phase 1

Do not crawl all of `caspel.com` during Phase 1.

Start with approved PDFs.

If website ingestion is added later, it should use explicitly approved URLs and snapshot their content into the knowledge base.

Do not make CASPEL AI depend on live website scraping for every question.

---

# 46. China Connectivity Constraints

The final system must work in Beijing, China.

Therefore critical frontend functionality must not depend on potentially inaccessible third-party assets.

Do not use external runtime dependencies for:

```text
fonts
CSS
core JS
PDF viewing
QR generation
images
videos
forms
analytics
```

These should be self-hosted or bundled.

Gemini is an explicit external AI dependency and must only be called by the CASPEL backend.

The browser must never directly call Gemini.

---

# 47. Graceful AI Failure

The landing page must continue to work if Gemini is unavailable.

If AI fails:

```text
website still works
product pages still work
PDF viewer still works
downloads still work
Request Demo still works
```

The chatbot should return a graceful message such as:

```text
CASPEL AI is temporarily unavailable.
Please explore our presentations or contact our team.
```

AI failure must never cause total page failure.

---

# 48. Nginx

Use Nginx as the local production-like entry point.

Responsibilities:

* serve frontend build;
* serve self-hosted assets;
* serve PDFs;
* proxy `/api/*` to FastAPI;
* SPA route fallback;
* sensible static caching;
* basic security headers;
* body size limits;
* optional simple request rate limiting where appropriate.

Do not expose FastAPI directly to the public-facing browser in the production-shaped architecture.

---

# 49. Docker Compose

Create a reproducible Docker Compose environment.

Expected services:

```text
nginx
backend
postgres
```

You may add a separate frontend build stage rather than runtime service.

Avoid unnecessary containers.

A target command should be:

```bash
docker compose up -d --build
```

After startup:

```bash
docker compose ps
```

should show healthy/running core services.

---

# 50. Docker Health Checks

Add reasonable health checks.

Examples:

PostgreSQL:

```bash
pg_isready
```

FastAPI:

```text
/api/health
```

Nginx may check local root or health endpoint.

---

# 51. Environment Variables

Create `.env.example`.

Never commit `.env`.

Potential values include:

```text
APP_ENV=development

POSTGRES_DB=ciftis
POSTGRES_USER=ciftis
POSTGRES_PASSWORD=

DATABASE_URL=

GEMINI_API_KEY=
GEMINI_CHAT_MODEL=
GEMINI_EMBEDDING_MODEL=

VITE_PUBLIC_CIFTIS_URL=http://localhost:8080/ciftis
VITE_DISPLAY_RESET_SECONDS=25
```

Adjust naming if technically appropriate.

Secrets must remain server-side.

---

# 52. Security Baseline

Implement basic security practices.

At minimum:

* server-side input validation;
* sane maximum lengths;
* request size limits;
* no secrets in frontend;
* no secrets committed;
* database credentials via environment;
* same-origin architecture where possible;
* safe error messages;
* parameterized database access through ORM;
* HTML escaping handled by framework;
* prevent arbitrary file path access;
* no executable user uploads.

Do not implement intrusive CAPTCHA in Phase 1.

---

# 53. Spam Protection Foundation

The final Request Demo endpoint will require low-friction server-side spam protection.

Phase 1 may prepare for:

```text
rate limiting
honeypot
minimum submission timing
payload validation
```

Do not depend on Google reCAPTCHA.

---

# 54. Development Experience

A new developer should be able to do approximately:

```bash
git clone <repo>
cd caspel-ciftis
cp .env.example .env
docker compose up -d --build
```

and have the foundational application running.

Document any additional steps.

---

# 55. Local Development Ports

Do not assume commonly occupied ports are free without checking.

Prefer making the public port configurable.

For example:

```text
APP_HTTP_PORT=8080
```

Then local URL:

```text
http://localhost:8080/ciftis
```

If 8080 is already occupied, choose another clean configurable value rather than killing unrelated services.

---

# 56. Preflight Checks

Before significant modifications, inspect the environment using Linux CLI.

For example:

```bash
pwd
uname -a
cat /etc/os-release
git status
docker --version
docker compose version
node --version
npm --version
python3 --version
```

Do not unnecessarily reinstall working tools.

If a dependency is missing, state why it is needed and install it using Linux-compatible methods where safe.

---

# 57. Existing Repository Safety

If a repository already exists:

* inspect it first;
* read README/package files;
* run `git status`;
* do not destroy existing user work;
* do not blindly overwrite configuration;
* integrate cleanly.

Before destructive operations, inspect what will be affected.

Do not use:

```bash
rm -rf .
git reset --hard
git clean -fd
```

without an extremely clear and necessary reason.

---

# 58. Git Hygiene

Use a clean `.gitignore`.

Ignore at least:

```text
.env
node_modules
dist
__pycache__
.pytest_cache
.venv
database volumes
temporary PDF processing artifacts
IDE/system clutter where appropriate
```

Do not commit secrets.

If Git is already initialized, preserve its history.

---

# 59. Tests

Create meaningful Phase 1 tests.

Backend tests should cover at least:

```text
health endpoint
lead validation
lead persistence
analytics event persistence
database connectivity
RAG retrieval logic where practical
chat behavior with mock provider
```

Frontend tests should cover important basic logic where useful, especially:

```text
product configuration
Page A QR state/reset logic
major route/component rendering
```

Do not chase artificial 100% coverage.

---

# 60. Smoke Tests

After building the stack, run Linux CLI smoke tests.

Examples:

```bash
curl -i http://localhost:8080/api/health
```

Test a lead:

```bash
curl -i \
  -X POST \
  http://localhost:8080/api/leads \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Phase One Test",
    "company": "CASPEL Test",
    "business_email": "phase1@example.com",
    "interest": "erp"
  }'
```

Test an analytics event.

Test the main frontend route.

Use Linux syntax only.

---

# 61. Verify Database State

Do not merely assume inserts worked.

Use a PostgreSQL command from inside the container where appropriate.

For example:

```bash
docker compose exec postgres psql ...
```

Verify:

```text
lead row exists
analytics row exists
vector extension exists
migrations applied
```

---

# 62. Verify pgvector

Explicitly verify:

```sql
SELECT extname
FROM pg_extension
WHERE extname = 'vector';
```

and ensure the result includes:

```text
vector
```

---

# 63. Direct Route Refresh

Because React Router may be used, verify Nginx SPA fallback.

These direct URLs must not become Nginx 404s:

```text
/ciftis
/ciftis/display
/ciftis/product/erp
```

A browser refresh on a frontend route must resolve correctly.

---

# 64. No Broken Core Dependencies

Inspect browser/network behavior if possible.

The foundational site should not require requests to unrelated third-party domains for:

```text
CSS
fonts
JavaScript
icons
QR
video
PDFs
analytics
```

If an external runtime request is necessary, document it explicitly.

Gemini backend access is the expected AI exception.

---

# 65. UI Design Philosophy

Use a professional structure suitable for:

```text
modern
premium
minimal
enterprise technology
international
clean UI
```

But Phase 1 is not the final visual-polish phase.

If official CASPEL:

```text
logo
colors
brand guideline
fonts
covers
```

exist in the current workspace, inspect and reuse them.

Do not invent a new CASPEL visual identity.

If the assets are not available:

* build using CSS variables/design tokens;
* use neutral placeholders;
* make future replacement trivial.

---

# 66. CSS Design Tokens

Create centralized variables where appropriate:

```css
--color-primary
--color-background
--color-surface
--color-text
--color-muted
--radius-card
--spacing-*
--font-family
```

When actual CASPEL brand values arrive, they should be easy to replace.

---

# 67. Accessibility

Even though this is exhibition-oriented, use sensible accessibility:

* semantic HTML;
* button elements for actions;
* labels for form inputs;
* visible focus states;
* appropriate contrast;
* `aria` attributes where necessary;
* reduced-motion consideration for optional animations.

---

# 68. SEO Foundation

Prepare basic metadata:

```text
title
meta description
favicon hook
Open Graph hook
semantic heading structure
```

Do not spend large Phase 1 effort on SEO.

---

# 69. Logs

Backend logs should be useful but not leak secrets.

Do not log:

```text
GEMINI_API_KEY
database password
Microsoft secrets
full environment dumps
```

Log meaningful information such as:

```text
request failures
RAG latency
retrieval result counts
Gemini failures
database errors
```

---

# 70. Error Handling

Frontend should display clean user-facing errors.

Backend should not return Python tracebacks to clients.

For example:

```text
Database internal error
```

must not reveal credentials or SQL internals.

---

# 71. API Responses

Use stable JSON response structures.

Examples:

Lead success:

```json
{
  "success": true,
  "message": "Your request has been received."
}
```

Chat response concept:

```json
{
  "answer": "...",
  "sources": [
    {
      "document": "CASPEL ERP Presentation",
      "page": 14
    }
  ]
}
```

---

# 72. Do Not Implement Fake Business Content

This is important.

Do not invent:

```text
CASPEL client names
CASPEL revenue
CASPEL office locations
ERP capabilities
PMS capabilities
IRISSEA capabilities
certifications
pricing
partnerships
CIFTIS claims
```

unless information exists in provided approved files.

Use placeholders where necessary.

---

# 73. Phase 1 Completion Criteria

Phase 1 should not be considered finished until the following are verified:

* [ ] Linux/WSL-compatible workflow exists.
* [ ] No Windows CMD/PowerShell commands are used for project operations.
* [ ] Repository structure is clean.
* [ ] Frontend builds successfully.
* [ ] Backend starts successfully.
* [ ] PostgreSQL starts successfully.
* [ ] pgvector is enabled.
* [ ] Alembic migrations work from a fresh database.
* [ ] Nginx starts successfully.
* [ ] `docker compose up -d --build` succeeds.
* [ ] `/ciftis` loads.
* [ ] `/ciftis/display` loads.
* [ ] Page B shows four correct primary product choices.
* [ ] Page A has video-loop/QR-overlay state foundation.
* [ ] QR target is configurable.
* [ ] Product routing is config-driven.
* [ ] `/api/health` responds successfully.
* [ ] `/api/leads` validates and persists a lead.
* [ ] `/api/events` persists an analytics event.
* [ ] chat persistence schema exists.
* [ ] RAG document/chunk schema exists.
* [ ] pgvector retrieval foundation exists.
* [ ] Gemini key is server-side only.
* [ ] one RAG vertical slice works if real credentials/material are available.
* [ ] synthetic tests are clearly marked if real material is unavailable.
* [ ] frontend survives Gemini/RAG failure.
* [ ] no critical asset requires third-party CDN.
* [ ] `.env` is not committed.
* [ ] tests pass.
* [ ] smoke tests pass.
* [ ] direct frontend route refresh works through Nginx.
* [ ] README contains Linux commands.
* [ ] architecture documentation exists.
* [ ] unresolved Phase 2 items are documented.

---

# 74. Phase 1 Is NOT Expected to Finalize

Do not waste time pretending the following are finalized when information is unavailable:

```text
final production CASPEL domain routing
final CASPEL Linux server deployment
Microsoft Graph credentials
final lead notification recipient
final privacy copy
final China connectivity test
final IRISSEA copy/screenshots
final CASPEL AI knowledge corpus
final four-PDF ingestion if PDFs are unavailable
final visual polish
final CIFTIS booth video
final Chinese translation
```

Scaffold clean extension points instead.

---

# 75. Documentation

Create or update:

```text
README.md
ARCHITECTURE.md
PHASE1_REPORT.md
```

## README.md

Must include Linux-only commands for:

```text
environment setup
starting project
stopping project
viewing logs
running migrations
running tests
running document ingestion
checking health
rebuilding Docker images
```

---

# 76. ARCHITECTURE.md

Explain:

```text
Page A
Page B
Nginx
FastAPI
PostgreSQL
pgvector
RAG flow
Gemini boundary
analytics
lead storage
future Microsoft Graph integration
production deployment concept
```

Include simple ASCII diagrams.

---

# 77. PHASE1_REPORT.md

At the end of your work, write a concrete report containing:

```text
1. What was implemented
2. Files created/modified
3. Architecture decisions
4. Commands executed
5. Test results
6. Docker status
7. API smoke-test results
8. RAG test result
9. Known limitations
10. Missing external materials
11. Security considerations
12. Phase 2 recommended tasks
```

Do not write vague statements such as:

```text
Everything should work.
```

State what was actually verified.

---

# 78. Final Agent Response

After completing the implementation, report back in this format:

```text
PHASE 1 STATUS: COMPLETE / PARTIAL / BLOCKED

Implemented:
- ...

Verified:
- ...

Tests:
- ...

Running services:
- ...

Local URLs:
- ...

RAG status:
- ...

Missing external inputs:
- ...

Important risks:
- ...

Recommended Phase 2 starting point:
- ...
```

If something is not working, say so clearly.

Do not hide errors.

---

# 79. Working Style

While implementing:

1. inspect before editing;
2. make small coherent changes;
3. run tests frequently;
4. fix issues immediately;
5. verify actual runtime behavior;
6. avoid unnecessary dependencies;
7. favor Linux-native workflows;
8. keep secrets out of source code;
9. do not overengineer;
10. do not stop at a theoretical plan.

When faced with a small implementation choice, make a reasonable engineering decision and continue.

Only stop for user input if there is a genuinely blocking issue such as unavailable credentials required for a real external service, destructive action affecting existing work, or missing access that cannot be safely mocked.

For missing CASPEL assets or credentials, build the extension point, clearly mark the limitation, and continue with everything else.

---

# 80. Final Priority

The most important outcome of Phase 1 is not visual perfection.

The most important outcome is:

```text
A production-shaped,
Linux-first,
Dockerized,
self-hosted-friendly,
China-conscious,
RAG-ready CASPEL CIFTIS foundation
that actually runs.
```

Prioritize:

```text
architecture
→ reproducibility
→ working vertical slice
→ correctness
→ tests
→ maintainability
→ visual polish
```

Now inspect the workspace and begin implementation.

Do not merely return a plan.

Perform the work.
