# CASPEL CIFTIS 2026 — public deployment plan

**Status: proposal. Nothing in this document has been executed.**
No server has been touched, no DNS record changed, no certificate issued.
Every step below waits on explicit operator approval.

---

## 0. What has and has not been verified

This distinction matters more than anything else in this document.

| | |
|---|---|
| **Verified** | The stack builds and runs on this machine, reachable at `http://127.0.0.1:8080` |
| **Not verified** | Anything about `caspel.com`, TLS, DNS, the public internet, or a Chinese network |

`127.0.0.1:8080` is a loopback address on a developer laptop. It is bound to
loopback deliberately so it *cannot* serve the public. It proves the containers
are correct; it proves nothing about the deployment. No claim about production
readiness can rest on it.

---

## 1. URL topology — the decision that gates everything else

`caspel.com` already serves CASPEL's corporate website. The exhibition hub has
to live alongside it without breaking it, and the printed QR code fixes the URL
permanently once it goes to print.

### Option A — subdomain: `https://ciftis.caspel.com` *(recommended)*

| | |
|---|---|
| Frontend | `https://ciftis.caspel.com/ciftis` |
| API | `https://ciftis.caspel.com/api` |
| Code changes | **none** — this is what the build already produces |
| Risk to the existing site | **none** — separate host, separate vhost, separate certificate |
| DNS | one new `A`/`AAAA` record |

The corporate site is untouched. A misconfiguration takes down the exhibition
hub and nothing else. This is the only option where a mistake cannot damage
`caspel.com` itself.

### Option B — path mount: `https://caspel.com/ciftis`

This is the URL you named. It is achievable, but it is **not** a deployment-only
change — it requires rebuilding the frontend and re-testing:

| Change | File |
|---|---|
| `base: '/ciftis/'` so assets resolve to `/ciftis/assets/…` | `frontend/vite.config.ts` |
| Router `basename="/ciftis"` | `frontend/src/App.tsx` |
| API calls `/api/…` → `/ciftis/api/…` | `services/api.ts`, `services/presentations.ts`, `services/analytics.ts` |
| Proxy `/ciftis/api/` → backend, stripping the prefix | host vhost + `nginx/nginx.conf` |
| `VITE_PUBLIC_SITE_URL=https://caspel.com` | `.env` |

The API **must** be mounted at `/ciftis/api`, not `/api`. A bare `/api` on
`caspel.com` risks colliding with whatever the corporate site already serves
there — and if it does collide, the failure lands on the corporate site, during
the exhibition.

### Option C — redirect

Print `https://caspel.com/ciftis`, serve a 301 to `ciftis.caspel.com/ciftis`.
Keeps the printed URL and the zero-risk topology, at the cost of one extra
round trip on every scan. Acceptable only if that redirect is confirmed fast
and reliable from a Chinese mobile network — an extra hop is an extra thing
that can be slow or blocked.

**Recommendation: A, or C if the printed URL must read `caspel.com/ciftis`.**
Option B is the highest-risk of the three because its blast radius includes the
corporate site. I need your decision before any code changes, because B changes
the build and invalidates the current verification.

---

## 2. Backend region — Gemini availability

The browser never calls Google. Only the backend does, which is the design
decision that lets the page work from China at all. That places one hard
constraint on hosting:

- The backend must sit in a region where the Gemini API is actually reachable
  and permitted for this API key. Verify with `verify_gemini_integration.py`
  **from the target host**, not from here — regional availability is a property
  of where the server is, and a pass on this laptop says nothing about it.
- Do **not** host the backend inside mainland China. Outbound access to Google
  APIs cannot be relied on from there, and the assistant would fail at the stand.
- Candidate regions to confirm before committing: Singapore, Tokyo, Frankfurt.
  Choose on measured latency from Beijing, not on assumption.

Latency budget: a visitor is standing at the stand. The generation deadline is
30s with a 20s per-request cap, so a region that adds 400ms is fine and one that
adds 4s is not.

---

## 3. TLS and DNS

1. DNS `A`/`AAAA` → the host's public IP. Confirm propagation before requesting
   a certificate; a certificate request against unpropagated DNS fails and can
   hit rate limits.
2. Let's Encrypt via certbot for the chosen hostname.
3. Redirect `http://` → `https://` permanently.
4. HSTS **only after** HTTPS is confirmed working end to end. Enabling it early
   and then needing to fall back to HTTP locks out every browser that saw it.
5. Confirm the full chain serves correctly — some Android and older iOS clients
   are stricter than desktop browsers about intermediate certificates, and a
   phone at the stand is the only client that matters.

The container publishes to `127.0.0.1` only. The host vhost is the sole public
entry point and owns TLS, HSTS and CSP. That arrangement stays.

---

## 4. Order of operations

Each step is reversible; each gate is a stop.

1. **Decide the URL topology** (§1) — *your call, blocks everything*
2. If Option B: make the code changes, rebuild, re-run the full verification
3. Provision the host; install Docker and the host nginx
4. DNS record; confirm propagation
5. Copy the repo; create `.env` from `.env.example` with production values
   — a fresh 32+ character database password, never the local one
6. `./deploy/deploy.sh` — builds, migrates, verifies
7. `docker compose exec -T backend python scripts/ingest_documents.py`
8. Issue the certificate; enable the vhost
9. `./deploy/deploy.sh --check` against the public hostname
10. **Live Gemini verification from the target host** (§2)
11. **Beijing mobile test** (§5) — *the last gate before printing*
12. Only then: print the QR code

Rollback at any point: `docker compose down` (without `-v`, so the database
volume survives) and disable the vhost. The corporate site is unaffected
throughout under Option A.

---

## 5. Beijing / China mobile verification

This cannot be simulated from here, and it is the check most likely to fail.
It needs a real device on a real Chinese mobile network — not a VPN, not
devtools throttling, not a proxy.

- [ ] `https://<hostname>/ciftis` loads on a Chinese mobile network
- [ ] Loads on both iOS Safari and Android Chrome
- [ ] The QR code, printed at final size, scans and resolves
- [ ] The Corporate deck (24 MB) opens and scrolls — this is the slowest path,
      and it is the one a visitor will judge the stand by
- [ ] Pinch-zoom works on a real iPhone
- [ ] CASPEL AI answers, with citations
- [ ] Request a Demo submits successfully
- [ ] Time-to-first-render is acceptable on a congested hall network

Two things are worth knowing in advance: the self-hosted Inter font and the
self-hosted pdf.js worker exist specifically so nothing is fetched from a CDN
that may be unreachable. If the page still fails from China, the cause is the
hostname or the network path, not a third-party asset — check DNS resolution
and TLS from the device before changing anything in the application.

---

## 6. Approval gate

I will not touch a server, DNS record, or certificate without you saying so.
When you are ready, tell me:

1. which URL topology (A, B or C);
2. the target host and region;
3. whether I should execute, or hand you the commands to run yourself.
