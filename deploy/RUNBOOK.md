# CASPEL CIFTIS 2026 — Deployment Runbook

Everything needed to put the Digital Presentation Hub on a Linux server with
HTTPS, and to operate it during the exhibition.

**Architecture**

```
Visitor phone
  │  HTTPS
  ▼
host nginx  :443            TLS, HSTS, CSP, rate limiting
  │  HTTP → 127.0.0.1:8080  (loopback only, never public)
  ▼
nginx container             built SPA + /api proxy
  │
  ▼
FastAPI container  :8000    presentations, leads, analytics, chat, admin
  │
  ▼
Postgres + pgvector
```

Nothing the browser loads comes from a third-party host — no CDN, no remote
fonts, no external embeds. That is what makes the page work from Beijing
(`document.md` §24).

---

## 1. Server prerequisites

Ubuntu 22.04+ or Debian 12+, 2 vCPU / 4 GB RAM / 20 GB disk is comfortable.

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git curl

# Docker Engine + Compose v2
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
```

Open only what is needed:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Port 8080 stays closed to the outside; Compose binds it to `127.0.0.1` only.

## 2. Get the code and the decks

```bash
sudo mkdir -p /opt/caspel-ciftis && sudo chown "$USER" /opt/caspel-ciftis
git clone <repository-url> /opt/caspel-ciftis
cd /opt/caspel-ciftis
```

Copy the presentation PDFs into `data/presentations/`, using exactly these
filenames (`document.md` §13):

```
CASPEL_Corporate_Presentation.pdf
CASPEL_ERP_Presentation.pdf
CASPEL_PMS_Presentation.pdf
IRISSEA_LRIT_Presentation.pdf
```

A deck is published only if the file on disk is byte-for-byte the approved one:
exact size, exact SHA256, a successful PDF parse and the exact approved page
count, all registered in `backend/app/core/presentations.py`. A recompressed,
truncated or substituted file is refused and the product shows an honest
"not yet published" state rather than serving the wrong document under a CASPEL
product name. Replacing a bad file with the approved one republishes it with no
restart — see §8.

## 3. Configure

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Required, no defaults — the stack refuses to start without them:

| Variable | Notes |
|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Use a generated password |
| `GEMINI_API_KEY` | Required in production. Only the server talks to Google, which is what keeps the page working from China |
| `VITE_PUBLIC_SITE_URL` | The real public origin, e.g. `https://caspel.com`. **Baked in at build time** for canonical, Open Graph and the QR target. The build FAILS on a missing, loopback or non-https value — there is no runtime fix once the QR code is printed |

Also set:

| Variable | Notes |
|---|---|
| `APP_ENV=production` | The backend refuses to start unless the password is 16+ characters, `ALLOW_MOCK_RAG` is false and a Gemini key is set |
| `ALLOW_MOCK_RAG=false` | Must stay false. `/api/ready` refuses to report ready while it is on |
| `TRUSTED_PROXY_COUNT=1` | Number of proxies in front of the app; the rate limiter reads that entry of `X-Forwarded-For` so a client cannot forge its own identity |
| `GEMINI_API_KEY` | Without it CASPEL AI reports itself unavailable; the rest of the hub works |
| `VITE_PUBLIC_CIFTIS_URL` | The QR target, e.g. `https://ciftis.caspel.com/ciftis` |

```bash
chmod 600 .env
```

## 4. Deploy

```bash
./deploy/deploy.sh
```

It pre-flights the configuration, builds, runs migrations, waits for health,
then verifies the routes that matter — including that a byte-range request
returns `206` and that `/api/admin/leads` returns `401` when signed out.

## 5. TLS and the public vhost

```bash
sudo cp deploy/nginx/caspel-ciftis.conf /etc/nginx/sites-available/
sudo sed -i 's/ciftis\.caspel\.com/YOUR-HOSTNAME/g' \
  /etc/nginx/sites-available/caspel-ciftis.conf
sudo ln -sf /etc/nginx/sites-available/caspel-ciftis.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

sudo mkdir -p /var/www/certbot
sudo certbot --nginx -d YOUR-HOSTNAME

sudo nginx -t && sudo systemctl reload nginx
```

Renewal is automatic via certbot's timer. Confirm with
`sudo certbot renew --dry-run`.

## 6. Start on boot

```bash
sudo cp deploy/caspel-ciftis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now caspel-ciftis
```

Reboot once and confirm the site comes back on its own. During the exhibition
nobody should need to SSH in after a power cut.

## 7. Index the presentations for CASPEL AI

The assistant answers only from the indexed decks, so run this after the PDFs
are in place and again whenever one is replaced:

```bash
docker compose exec backend python scripts/ingest_documents.py
```

Pages with no extractable text are skipped and logged. They are never replaced
with generated prose — anything indexed can be quoted back to a visitor as
CASPEL's own material.

Verify the AI path end to end:

```bash
docker compose exec backend python scripts/verify_gemini_integration.py
```

It exits non-zero if the service is falling back to a canned reply.

## 8. Adding the PMS or IRISSEA deck later

```bash
scp CASPEL_PMS_Presentation.pdf server:/opt/caspel-ciftis/data/presentations/
docker compose exec backend python scripts/ingest_documents.py   # for CASPEL AI
```

That is all. Availability is read from disk per request, so the card, the
viewer and the download go live immediately. No rebuild, no restart, no code
change.

## 9. Pre-exhibition checklist

Work through this **before the QR code goes to print** — the printed URL cannot
be changed afterwards (`document.md` §24, §35).

- [ ] `https://<hostname>/ciftis` loads; `http://` redirects with `301`
- [ ] SSL Labs grade A or better
- [ ] All four cards appear; published decks open and download
- [ ] PDF scroll **and pinch-zoom on a real iPhone and a real Android phone** — not devtools
- [ ] Request a Demo submits and the row appears in the database (§10)
- [ ] Both modals close on Escape, trap Tab, and return focus to the button that opened them
- [ ] CASPEL AI answers with cited sources; if the provider is down it shows a retryable failure, never an apology presented as an answer
- [ ] No horizontal scrolling at 320, 360, 375, 390, 414 and 430 px
- [ ] `curl -s https://<hostname>/api/ready` reports `"status":"ready"` with all five checks true
- [ ] `/ciftis/admin` and `/ciftis/status` do not exist, and `/api/admin/*` returns 404
- [ ] **Load the production URL from a device on a Chinese network**
- [ ] QR code scans to the correct URL from a printed sample

## 10. Operating during the exhibition

| Task | Command |
|---|---|
| Service health | `curl -s https://<hostname>/api/ready` |
| Leads and questions | `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"` — there is deliberately no public admin page |
| Corpus statistics | `docker compose exec -T backend python scripts/ingest_documents.py --report-only` |
| Follow logs | `docker compose logs -f backend` |
| Restart | `sudo systemctl restart caspel-ciftis` |
| Re-verify routes | `./deploy/deploy.sh --check` |
| Export leads | see below |

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "\copy (SELECT name, company, business_email, interest, created_at \
             FROM leads ORDER BY created_at DESC) TO STDOUT WITH CSV HEADER" \
  > leads-$(date +%F).csv
```

**Booth display:** open `https://<hostname>/ciftis/display` full-screen on the
stand screen. It reveals the QR code on tap and resets itself after
`VITE_DISPLAY_RESET_SECONDS` (default 25).

## 11. Backup and rollback

```bash
# Nightly backup of leads, analytics and chat history
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "/opt/backups/caspel-$(date +%F).sql.gz"
```

Roll back to a previous commit:

```bash
cd /opt/caspel-ciftis
git checkout <previous-commit>
./deploy/deploy.sh
```

The database volume survives `docker compose down`. To destroy it deliberately,
`docker compose down -v` — take a dump first.

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Every deck shows "not yet published" | Files missing, misnamed, or not matching their approved SHA256. Check `curl -s localhost:8080/api/presentations` and the backend log |
| Viewer blank on iPhone | Confirm `/assets/pdf.worker.min-*.js` returns 200. A CSP without `worker-src blob:` blocks it |
| Range requests return 200 not 206 | `proxy_buffering off` is missing from the `/api/` block |
| A deck shows "not yet published" although the file is there | Its SHA256, size or page count does not match the approved values. `docker compose logs backend` names the exact reason. Do not "fix" it by loosening the check |
| Frontend build fails on `VITE_PUBLIC_SITE_URL` | Deliberate. Set the real https:// origin; a localhost build would ship a QR code pointing at the build machine |
| Backend exits at startup | A required variable is missing or invalid. Inspect `docker compose logs backend` |
| Migration fails with an existing unversioned schema | Do not stamp blindly. Confirm the tables match `001_initial_schema`, back up the database, then run `docker compose run --rm backend alembic stamp 001_initial_schema` once. |
| AI replies "temporarily unavailable" | Missing/invalid `GEMINI_API_KEY`, no indexed documents, or the server cannot reach Google. Run `verify_gemini_integration.py` |
| 429 responses | Rate limits in nginx and `RATE_LIMIT_*`. Raise deliberately, not reflexively |
