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

Routes below are written **relative to the deployment base**. The public prefix
belongs to `VITE_APP_BASE_PATH` and the host vhost, never to the application:
`/display` is served at `https://ciftis.caspel.com/display` in Mode A and at
`https://caspel.com/ciftis/display` in Mode B. See §2.6.

### 2.1. Page A — Exhibition Display / Kiosk (`/display`)
- **Intent**: High-resolution, unattended touch screen situated at the physical CASPEL exhibition booth in Beijing.
- **Visual State**: A silent, muted, looping local MP4 (`frontend/src/assets/caspel.mp4`) filling the viewport. No external media.
- **Interaction**: Tap anywhere to pause the film and raise a modal QR code.
- **Auto-Reset**: Inactivity timer (`VITE_DISPLAY_RESET_SECONDS`, default 25s) dismisses the QR and resumes the film if the visitor leaves.
- **Local QR Engine**: Generates the QR client-side as inline SVG, with no call to an external generator. The destination is the validated `VITE_PUBLIC_URL`, never the current URL, so it can never encode `/display`.
- **Failure States**: Autoplay refused shows a touch-to-start prompt; a film that cannot load shows the QR and the readable address directly.

### 2.2. Page B — Mobile Landing Page (`/`)
- **Intent**: Mobile presentation hub accessed when visitors scan the physical booth QR code.
- **Information Hierarchy** (ordered so the first 390×844 screen carries everything a visitor needs):
  1. CASPEL and CIFTIS marks, plus the language selector
  2. Event kicker and a factual page-purpose statement
  3. **CASPEL AI entry** — a real button in the page flow, complete within the first viewport, never fixed or floating
  4. Four solution rows (*Corporate*, *ERP*, *PMS*, *IRISSEA*), all names visible in the first viewport at 390×844
  5. Request a Demo and contact actions
  6. Corporate footer

### 2.3. Product presentation (`/product/:slug`)
- **Canonical route.** Selecting a product opens the document itself; there is no intermediate summary step.
- **Legacy compatibility**: `/presentation/:slug` redirects to `/product/:slug` with `replace` history semantics, preserving search and hash, and emits no analytics of its own.
- **States, kept deliberately distinct**: manifest loading; approved and available (viewer mounts); unavailable (honest "not yet published"); manifest/API error (retryable, never presented as unpublished); PDF render failure (retry plus download fallback).
- **Analytics**: `PRODUCT_VIEW` fires exactly once per product entered; `PRESENTATION_VIEW` fires exactly once and only when an approved viewer actually mounts.
- **Availability** is decided by the backend's approved registry (exact size, SHA256 and page count), never by file presence.

### 2.4. CASPEL AI — Grounded RAG Assistant (`/api/chat`)
- **Knowledge Sources**: Approved slide presentations parsed page-by-page.
- **Retrieval Engine**: Embeddings computed with `gemini-embedding-2` (768 dimensions), indexed with `pgvector` in PostgreSQL using cosine distance `<=>`. Generation uses `gemini-3.5-flash-lite`. Both are environment-selected with no automatic fallback.
- **Response language** is resolved server-side, before the provider is called, by `app/rag/language.py`: an explicit request in the message wins; otherwise the language the question is written in (English, Simplified Chinese, Azerbaijani); otherwise the browser UI locale, but only for input too short to classify; otherwise English. `ChatRequest.ui_locale` is a hint, never an override.
- **No-context behaviour**: when retrieval returns nothing, a reviewed refusal is returned in the resolved language and **the provider is not called at all**.
- **Source citations are server-owned** (`app/rag/citations.py`). Retrieved records are labelled `SOURCE_1`, `SOURCE_2`, … and the model may reference only those identifiers. Every identifier it returns is validated against what was actually retrieved, then resolved to the server's own document title and page number. An identifier the model invents resolves to nothing and is dropped, so a fabricated page can never reach a visitor.
- **Prompt-injection posture**: retrieved text and the visitor message are fenced and labelled as data. The system prompt forbids following instructions found inside them and forbids disclosing its own configuration.
- **Failure honesty**: a provider failure is an HTTP 503, never a 200 carrying an apology, and is never written to the transcript as an answer.

### 2.5. Interface localization
- English and Simplified Chinese resources are **bundled into the build**. Nothing is fetched at runtime and no translation service is contacted.
- **Precedence**: a stored choice (`caspel_ciftis_locale`) → `navigator.languages` in the visitor's own order (`zh`, `zh-CN`, `zh-Hans` resolve to Simplified Chinese; Traditional Chinese deliberately does not) → English.
- Switching updates the page live without a reload and rewrites `<html lang>` and the document metadata.
- Product slugs, stream URLs, download filenames, document titles and page numbers are identifiers and are never translated.

### 2.6. Deployment modes and readiness
- **Mode A** — `https://ciftis.caspel.com/`, built with `VITE_APP_BASE_PATH=/`.
- **Mode B** — `https://caspel.com/ciftis/`, built with `VITE_APP_BASE_PATH=/ciftis/`, merged into the existing corporate vhost, which strips the prefix exactly once.
- The container nginx is **prefix-agnostic** and serves the SPA at its own root in both modes. Legacy `/ciftis` compatibility lives in the mode-specific host configuration, not in the container.
- `/api/ready` reports exactly four checks: **database**, **vector extension**, **live AI provider**, **approved corpus**. It returns 503 unless all four pass.

### 2.7. Interface design system

The rules below are load-bearing: each one exists because its absence produced a
defect that was visible on the stand. They are verified by
[DESIGN_PASS_VERIFICATION.md](DESIGN_PASS_VERIFICATION.md).

#### The assistant canvas — one surface, two states

**The ambient layer is never unmounted.** It is always present in the DOM and
carries `data-state`:

| `data-state` | When | Opacity | Animation | Compositor layers |
|---|---|---|---|---|
| `idle` | no message has been sent | `--chat-ambient-idle` (1) | running | 6 promoted |
| `receded` | any message, load or failure exists | `--chat-ambient-active` (0.18) | **paused** | 0 promoted |

This supersedes the earlier rule that removed the layer once a conversation
began. Unmounting it swapped a saturated dark field for a differently-coloured
document at the exact moment the visitor committed to using the assistant, and
the product read as two applications stitched together. The transcript is dark
in **both** states; only the ambient's presence changes.

It pauses rather than merely dimming, because dimmed motion still moves behind
long-form text and still holds six promoted compositor layers for the whole
conversation on an exhibition phone. `will-change` is therefore scoped to
`[data-state='idle']` — promotion follows the state that actually animates.

Under `prefers-reduced-motion`, the layer stays and holds a chosen static
composition: the same art direction, held still, with zero running animations
and zero promoted layers. It is not a 0.01ms loop and it is not removed.

#### Colour

The ambient palette is three brand hues — `--color-ai-forest`,
`--color-ai-emerald`, `--color-ai-teal` — composited with
`mix-blend-mode: screen` on `--chat-surface`. The former five-hue set (lime,
cyan, blue, violet, coral) is **deleted, not deprecated**: an orphaned token is
an invitation, and purple-blue-on-black is the single loudest generated-template
tell. Do not reintroduce it, and do not add an iridescent orbit to the mark.

Green is a four-step ramp — `--green-700` / `--green-500` / `--green-300` plus
`--green-on-primary` — not an ad-hoc green per component.

#### Arrows

One component, [`ActionArrow`](frontend/src/components/ActionArrow.tsx), with two
semantic variants chosen by **what the control does**, never by how its label
reads: `internal` for an in-product route, modal or action; `external` for a
destination that hands the visitor off, **including `mailto:`**. Opening a tab
and leaving the experience are separate questions and are answered by separate
flags (`newTab`, `leaves`) — conflating them is what made five of six arrows
point the wrong way. No literal `→` or `↗` glyph appears in visitor-facing JSX.

#### Focus, targets and motion

- **Focus** is one contract in `global.css`: a `:focus-visible` outline plus a
  `--focus-ring` box-shadow that follows `border-radius`, with a dark-surface
  variant. Never remove it per-component.
- **Targets** are at least `--target-min` (44px). The kiosk draws its own larger
  controls directly.
- **Motion** uses only the duration and easing tokens — no literal timings in
  any transition — and animates transform and opacity. `transition: all` is
  banned. The ambient's own 37–79s periods are literal and deliberately
  co-prime, so the composition never visibly repeats.

#### Layering and CJK typography

`z-index` comes from the named scale in `tokens.css` (`--z-decor` through
`--z-modal`); no magic numbers. The sticky header reserves `--header-height`
and every `[id]` carries a matching `scroll-margin-top`.

Simplified Chinese is set through `:root:lang(zh-CN)` — at the root, because
every property involved is inherited and a bare `:lang()` would override each
component's deliberate leading. It raises line-height, drops letter-spacing and
uppercase transforms (which do nothing to Han text), and prefers fonts the
reader already has; no CJK webfont is downloaded.

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
