# CASPEL CIFTIS 2026 — Hosting & Deployment Guide: Nginx on a Linux Server / WSL Ubuntu

Step-by-step instructions to run, deploy and host the CASPEL CIFTIS 2026 Digital
Presentation Hub on a Linux server, or on **WSL 2 (Ubuntu)** for validation,
behind **nginx**.

Read section 9 before handling anything the stand collects. Visitor lead data is
personal data, and the export command in this guide produces a file containing it.

---

## 0. Choose a deployment mode first

Everything else — DNS, TLS, the nginx configuration you install, and the build
arguments baked into the frontend image — follows from this choice. The two
modes are not interchangeable at runtime: the public path is compiled into the
bundle, so switching modes means rebuilding the image.

| | **Mode A — dedicated subdomain** | **Mode B — corporate subpath** |
|---|---|---|
| Public URL | `https://ciftis.caspel.com/` | `https://caspel.com/ciftis/` |
| `VITE_APP_BASE_PATH` | `/` | `/ciftis/` |
| `VITE_PUBLIC_URL` | `https://ciftis.caspel.com` | `https://caspel.com/ciftis` |
| DNS | **New** A/AAAA record for `ciftis.caspel.com` | **None.** Reuses the existing `caspel.com` record |
| TLS | **New** certificate for the subdomain (section 6) | **None.** Reuses the existing `caspel.com` certificate |
| nginx on host | Install `deploy/nginx/caspel-ciftis.conf` as its own vhost | **Merge** `deploy/nginx/caspel-com-ciftis-snippet.conf` into the existing corporate vhost |
| Corporate site risk | None — separate hostname | Requires editing live corporate config. Read section 5.2 |

> **Mode B is a merge, never a new virtual host.** The snippet contains
> `location` blocks only. Installing it as a second `server { server_name
> caspel.com; }` makes nginx choose between two vhosts non-deterministically and
> can take the corporate website offline.

---

## 1. System requirements & setup

WSL 2 with Ubuntu, or any Ubuntu/Debian server.

### 1.1 Start the Ubuntu shell (WSL only)
```bash
wsl -d Ubuntu
```

### 1.2 Install required packages
```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git curl
```

### 1.3 Install and start Docker Engine
```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
less /tmp/get-docker.sh          # review before running a piped installer as root
sudo sh /tmp/get-docker.sh
sudo usermod -aG docker "$USER"
sudo service docker start
```
Verify with `docker ps`. You may need to open a new shell for the group change
to apply.

---

## 2. Project directory & environment configuration

### 2.1 Navigate to the repository
```bash
cd /mnt/d/github_repos/caspel_ciftis2026     # WSL, repository on the Windows drive
# or, on a Linux server:
cd /opt/caspel-ciftis
```

### 2.2 Configure environment variables

```bash
cp .env.example .env
chmod 600 .env          # the file holds a database password and an API key
nano .env
```

`.env` is git-ignored and must stay that way. Never commit it, paste it into a
ticket, or copy it to a workstation.

```env
APP_ENV=production
APP_HTTP_PORT=8080

# Database
POSTGRES_DB=ciftis
POSTGRES_USER=ciftis
POSTGRES_PASSWORD=<GENERATE_A_STRONG_RANDOM_PASSWORD>
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# Gemini
GEMINI_API_KEY=<PASTE_THE_PROJECT_GEMINI_API_KEY>
GEMINI_CHAT_MODEL=gemini-3.5-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-2

# Deployment mode — see section 0. Mode A shown; for Mode B use
#   VITE_APP_BASE_PATH=/ciftis/
#   VITE_PUBLIC_URL=https://caspel.com/ciftis
VITE_APP_BASE_PATH=/
VITE_PUBLIC_URL=https://ciftis.caspel.com
VITE_DISPLAY_RESET_SECONDS=25
```

Generate the database password rather than inventing one, and never reuse a
password that has appeared in documentation, a chat message or an example:

```bash
openssl rand -base64 30
```

`DATABASE_URL` is assembled by Docker Compose from the values above, so the
password is written in exactly one place.

---

## 3. Building and starting the stack

`VITE_*` values are compiled into the frontend bundle at **build** time. Setting
them after the image is built has no effect — rebuild instead.

```bash
docker compose build
docker compose up -d
```

### 3.1 Verify
```bash
docker compose ps
curl -fsS http://127.0.0.1:8080/api/health     # liveness
curl -fsS http://127.0.0.1:8080/api/ready      # readiness: DB, corpus, embeddings
```

`/api/health` answers as soon as the process is up. `/api/ready` is the one that
matters before opening the stand: it fails while the corpus is unverified or
embeddings are missing.

Only nginx publishes a host port, bound to `127.0.0.1:8080`. The backend and
PostgreSQL are reachable only from the compose network — that is deliberate; do
not publish them.

---

## 4. Document ingestion

```bash
docker compose exec backend python scripts/ingest_documents.py
```

Ingestion reads the approved PDFs, verifies each against its pinned size and
SHA256, and writes chunks and embeddings. Re-run it only when the approved
corpus changes; it consumes Gemini embedding quota.

Then confirm readiness:

```bash
curl -fsS http://127.0.0.1:8080/api/ready
```

### 4.1 Verifying the assistant end to end

```bash
docker compose exec backend python scripts/verify_gemini_integration.py
```

> **This calls the live Gemini API and consumes paid quota.** Run it once after
> a key or model change, not as a routine health check. Use `/api/ready` for
> routine checks — it costs nothing.

---

## 5. Configuring nginx on the host

### 5.1 Mode A — dedicated subdomain

```bash
sudo cp deploy/nginx/caspel-ciftis.conf /etc/nginx/sites-available/caspel-ciftis.conf
sudo nano /etc/nginx/sites-available/caspel-ciftis.conf   # set server_name
```

Inspect what is already enabled **before** changing anything:

```bash
ls -l /etc/nginx/sites-enabled/
sudo nginx -T | grep -n "server_name"      # every vhost this server answers for
sudo tar czf ~/nginx-backup-$(date +%F-%H%M).tar.gz /etc/nginx
```

Enable the new site:

```bash
sudo ln -s /etc/nginx/sites-available/caspel-ciftis.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> Do **not** delete `/etc/nginx/sites-enabled/default` reflexively. On a shared
> server it may be a real site, or the catch-all that answers requests for
> hostnames you do not own. If you have confirmed from the listing above that it
> is the unmodified Debian placeholder and nothing else needs it, disable it by
> unlinking — never by deleting the file in `sites-available`:
> ```bash
> sudo unlink /etc/nginx/sites-enabled/default
> sudo nginx -t && sudo systemctl reload nginx
> ```
> Reverse it with `sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/`.

### 5.2 Mode B — beneath the corporate site

This edits the configuration of the **live corporate website**. Back it up
first, schedule it, and have someone able to reload nginx on hand.

```bash
sudo tar czf ~/nginx-backup-$(date +%F-%H%M).tar.gz /etc/nginx
sudo nginx -T > ~/nginx-effective-$(date +%F-%H%M).conf   # the config as nginx sees it
```

Install the snippet and include it **inside** the existing `caspel.com` server
block — do not create a second one:

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/caspel-com-ciftis-snippet.conf /etc/nginx/snippets/caspel-com-ciftis.conf
```

```nginx
server {
    server_name caspel.com;
    # ...existing corporate site configuration, unchanged...
    include /etc/nginx/snippets/caspel-com-ciftis.conf;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Then confirm the corporate site itself still answers, before checking the hub:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://caspel.com/
curl -fsS -o /dev/null -w '%{http_code}\n' https://caspel.com/ciftis/
```

If anything is wrong, restore the backup and reload.

### 5.3 Verify the security headers

Every HTML response must carry them. nginx silently drops inherited
`add_header` directives in any location that declares its own, so this is
checked rather than assumed:

```bash
# Mode A
scripts/verify-security-headers.sh http://127.0.0.1:8080
# Mode B
scripts/verify-security-headers.sh http://127.0.0.1:8080 /ciftis
```

---

## 6. TLS

**Mode A** needs a new certificate for the subdomain. Point DNS at the server
first, then:

```bash
sudo certbot --nginx -d ciftis.caspel.com
```

**Mode B** needs no new certificate and no DNS change — it is served by the
existing `caspel.com` vhost under its existing certificate. Do not run certbot
for Mode B; re-issuing the corporate certificate is not part of this deployment.

Renewal is handled by the packaged certbot timer. Verify with:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 7. Operational commands

| Action | Command | Notes |
|---|---|---|
| Liveness | `curl -fsS http://127.0.0.1:8080/api/health` | free |
| Readiness | `curl -fsS http://127.0.0.1:8080/api/ready` | free; use this before opening the stand |
| Security headers | `scripts/verify-security-headers.sh http://127.0.0.1:8080` | free |
| Backend logs | `docker compose logs -f backend` | may contain visitor questions — treat as personal data |
| Container status | `docker compose ps` | free |
| Ingest documents | `docker compose exec backend python scripts/ingest_documents.py` | **consumes Gemini embedding quota** |
| Verify the assistant | `docker compose exec backend python scripts/verify_gemini_integration.py` | **calls live Gemini; consumes paid quota** |

---

## 8. Stand booth display

Open the kiosk loop on booth touchscreens or tablets:

- Mode A: `https://ciftis.caspel.com/display`
- Mode B: `https://caspel.com/ciftis/display`
- Local validation: `http://localhost:8080/display`

The page plays the exhibition film full-screen and shows a QR code on tap. The
QR always points at the configured `VITE_PUBLIC_URL`, never at the kiosk URL.

---

## 9. Visitor data: access, retention and deletion

The stand collects personal data. Demo requests are stored in the `leads` table
(name, company, business email, area of interest, timestamp), and questions
asked of the assistant may contain identifying details a visitor typed.

**Access.** The database is not published on any host port. Reach it only
through `docker compose exec postgres psql`, from the server itself, by staff
who need it.

**Export.** Export only when there is a reason to, and only to the server:

```bash
docker compose exec postgres psql -U ciftis -d ciftis \
  -c "\copy (SELECT name, company, business_email, interest, created_at FROM leads ORDER BY created_at DESC) TO STDOUT WITH CSV HEADER" \
  > /root/leads-$(date +%F).csv
chmod 600 /root/leads-$(date +%F).csv
```

> **Do not leave `leads.csv` on a laptop.** An export is an unencrypted list of
> named individuals and their work email addresses. Transfer it over an
> encrypted channel to the system that will own it, confirm it arrived, then
> delete the copy from the server:
> ```bash
> shred -u /root/leads-YYYY-MM-DD.csv
> ```
> Do not email it, put it in shared cloud storage, or leave it in a downloads
> folder.

**Retention.** Agree a retention period with whoever is accountable for this
data before the exhibition opens, and delete what is past it:

```bash
docker compose exec postgres psql -U ciftis -d ciftis \
  -c "DELETE FROM leads WHERE created_at < now() - interval '12 months';"
```

**Deletion on request.** A visitor may ask for their data to be removed. Locate
and delete by email:

```bash
docker compose exec postgres psql -U ciftis -d ciftis \
  -c "DELETE FROM leads WHERE business_email = 'person@example.com';"
```

Delete any exported copies too — a CSV taken before the request still contains
the record.

**Never** put an API key, a database password, or a real visitor record into a
ticket, a screenshot, a commit message or a chat.
