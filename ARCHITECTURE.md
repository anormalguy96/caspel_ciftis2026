# CASPEL CIFTIS 2026 — Architecture Specification

This document details the software architecture, data models, infrastructure topologies, security boundaries, and operational considerations for the CASPEL CIFTIS 2026 digital exhibition platform.

---

## 1. System Architecture Diagram

```text
                               VISITOR / KIOSK CLIENT
                                         │
                                         │ HTTP (Port 8080) / HTTPS (Prod)
                                         ▼
                     ┌───────────────────────────────────────┐
                     │            NGINX REVERSE PROXY        │
                     │  - SPA Fallback (/ciftis, /display)   │
                     │  - Static Asset & PDF Byte-Serving    │
                     │  - Security Headers & Compression     │
                     └───────────────────┬───────────────────┘
                                         │
             ┌───────────────────────────┼───────────────────────────┐
             │                           │                           │
             ▼                           ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
    │ React 18 / Vite │         │  PDF Byte-Range │         │ FastAPI Backend │
    │ Static Frontend │         │  Presentations  │         │   (/api/*)      │
    │  - Page A (Kiosk│         │  - Corporate    │         └────────┬────────┘
    │  - Page B (Hub) │         │  - ERP / PMS    │                  │
    │  - Local QR SVG │         │  - IRISSEA LRIT │                  │
    └─────────────────┘         └─────────────────┘                  │
                                                                     │
                                 ┌───────────────────────────────────┼───────────────────────────────────┐
                                 │                                   │                                   │
                                 ▼                                   ▼                                   ▼
                    ┌─────────────────────────┐         ┌─────────────────────────┐         ┌─────────────────────────┐
                    │       PostgreSQL        │         │        pgvector         │         │     Google Gemini API   │
                    │  - leads                │         │  - document_chunks      │         │  - Server-side only     │
                    │  - analytics_events     │         │  - cosine distance <=>  │         │  - gemini-2.0-flash     │
                    │  - chat_sessions/msgs   │         │  - 768-dim embeddings   │         │  - text-embedding-004   │
                    └─────────────────────────┘         └─────────────────────────┘         └─────────────────────────┘
```

---

## 2. Core Subsystems

### 2.1. Page A — Exhibition Display / Kiosk (`/ciftis/display`)
- **Intent**: High-resolution, unattended touch screen situated at the physical CASPEL exhibition booth in Beijing.
- **Visual State**: Ambient gradient pulse and technology animation.
- **Interaction**: Tap anywhere to trigger modal QR code.
- **Auto-Reset**: Inactivity timer (`VITE_DISPLAY_RESET_SECONDS`, default 25s) automatically returns screen to ambient visual loop if visitor leaves.
- **Local QR Engine**: Generates QR code client-side using pure SVG without making outbound calls to external generator APIs.

### 2.2. Page B — Mobile Landing Page (`/ciftis`)
- **Intent**: Mobile presentation hub accessed when visitors scan the physical booth QR code.
- **Information Hierarchy**:
  1. CASPEL Brand Header & Online Indicator
  2. Hero Tagline ("Explore Caspel Solutions")
  3. Four Core Solution Cards (*Corporate*, *ERP*, *PMS*, *IRISSEA*)
  4. Presentation Access (In-browser viewer & direct download)
  5. CASPEL AI Assistant bottom-sheet launcher
  6. Request a Demo lead capture section
  7. Corporate Footer & Social Links

### 2.3. CASPEL AI — Grounded RAG Assistant (`/api/chat`)
- **Knowledge Sources**: Slide presentations parsed page-by-page.
- **Retrieval Engine**: Embeddings computed with `text-embedding-004`, indexed with `pgvector` in PostgreSQL using cosine distance `<=>`.
- **System Guardrails**: Explicit strict system instructions preventing hallucinations regarding prices, clients, unverified claims, or off-topic information.
- **Source Citations**: Returns exact document names and slide page numbers to the client for verifiable trust.

---

## 3. Data Model & Schema

```text
┌───────────────────────────┐         ┌───────────────────────────┐
│           leads           │         │     analytics_events      │
├───────────────────────────┤         ├───────────────────────────┤
│ id (PK, Integer)          │         │ id (PK, Integer)          │
│ name (String)             │         │ session_id (String, Index)│
│ company (String)          │         │ event_name (String, Index)│
│ business_email (String)   │         │ product (String, Nullable)│
│ interest (String)         │         │ metadata_json (JSON)      │
│ notification_status (Str) │         │ created_at (DateTime)     │
│ notification_attempts(Int)│         └───────────────────────────┘
│ created_at (DateTime)     │
└───────────────────────────┘

┌───────────────────────────┐         ┌───────────────────────────┐
│       chat_sessions       │ 1     * │       chat_messages       │
├───────────────────────────┤─────────├───────────────────────────┤
│ id (PK, Integer)          │         │ id (PK, Integer)          │
│ session_id (Str, Unique)  │         │ session_id (String, Index)│
│ started_at (DateTime)     │         │ role (String: user/asst)  │
│ created_at (DateTime)     │         │ content (Text)            │
└───────────────────────────┘         │ created_at (DateTime)     │
                                      └───────────────────────────┘

┌───────────────────────────┐         ┌───────────────────────────┐
│         documents         │ 1     * │      document_chunks      │
├───────────────────────────┤─────────├───────────────────────────┤
│ id (PK, Integer)          │         │ id (PK, Integer)          │
│ name (String)             │         │ document_id (FK -> doc.id)│
│ source_type (String)      │         │ page_number (Integer)     │
│ source_path (String)      │         │ chunk_index (Integer)     │
│ product (String, Nullable)│         │ content (Text)            │
│ created_at (DateTime)     │         │ embedding (Vector(768))   │
│ updated_at (DateTime)     │         │ created_at (DateTime)     │
└───────────────────────────┘         └───────────────────────────┘
```

---

## 4. China Connectivity & Firewall Resilience

The exhibition takes place in Beijing, China. The runtime architecture incorporates strict resilience measures:

1. **Zero External Runtime CDNs**: All JavaScript, CSS, fonts, SVG icons, and QR generators are bundled and served from the CASPEL Nginx container.
2. **System Font Fallbacks**: No dependencies on external Google Fonts.
3. **No External PDF SaaS**: PDF presentations are served directly via Nginx with HTTP byte-range caching.
4. **Backend-Only AI Boundary**: The browser never calls Gemini directly. All external AI calls originate from the server container. If AI connectivity degrades, all product presentations, downloads, and lead forms continue operating without interruption.

---

## 5. Security Architecture

- **Spam Protection**: Silent honeypot input fields filter automated bots without user-hostile CAPTCHA challenges.
- **Secret Isolation**: `GEMINI_API_KEY` and database credentials exist strictly server-side.
- **SQL Injection Prevention**: Parameterized queries enforced through SQLAlchemy 2.0 ORM.
- **Network Boundaries**: Only the Nginx reverse proxy exposes public ports (`8080`). PostgreSQL and FastAPI communicate over the internal Docker network.
- **Security Headers**: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, and `X-XSS-Protection` are attached to every response.
