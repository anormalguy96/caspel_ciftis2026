#!/usr/bin/env bash
#
# CASPEL CIFTIS 2026 — deploy the stack on the Linux host.
#
#   ./deploy/deploy.sh          build, migrate, restart, verify
#   ./deploy/deploy.sh --check  verify only, change nothing
#
# Safe to re-run. Run it from the repository root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

BASE_URL="${BASE_URL:-http://127.0.0.1:${APP_HTTP_PORT:-8080}}"

info()  { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
ok()    { printf '\033[0;32m  ok\033[0m %s\n' "$1"; }
warn()  { printf '\033[0;33m  !!\033[0m %s\n' "$1"; }
fail()  { printf '\033[0;31m  XX\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- checks
require_env() {
  local missing=()
  # Every one of these has no safe default; the stack must not start without them.
  for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
             GEMINI_API_KEY VITE_PUBLIC_URL; do
    grep -qE "^${key}=.+" .env || missing+=("$key")
  done

  if (( ${#missing[@]} )); then
    fail "Missing or empty in .env: ${missing[*]}"
  fi

  # A localhost site URL is baked into canonical tags, share cards and the
  # printed QR target, and cannot be changed after the code goes to print. The
  # frontend build refuses it too; catching it here saves a full image build.
  local site_url base_path
  site_url=$(grep -E "^VITE_PUBLIC_URL=" .env | head -n1 | cut -d= -f2-)
  base_path=$(grep -E "^VITE_APP_BASE_PATH=" .env | head -n1 | cut -d= -f2-)
  base_path="${base_path:-/}"

  # The two values describe the same mount point. If they disagree every
  # canonical link is wrong, so the build refuses; catch it before building.
  case "$base_path" in
    /) expected_path="" ;;
    /*/) expected_path="${base_path%/}" ;;
    *) fail "VITE_APP_BASE_PATH must be \"/\" or \"/segment/\", got: $base_path" ;;
  esac
  case "$site_url" in
    *localhost*|*127.0.0.1*|*0.0.0.0*)
      fail "VITE_PUBLIC_URL is a loopback address ($site_url). Shared links and the printed QR code would point at this machine." ;;
    https://*) ;;
    *) fail "VITE_PUBLIC_URL must be an https:// address, got: $site_url" ;;
  esac

  if grep -qE "^APP_ENV=production" .env; then
    local pw_len
    pw_len=$(grep -E "^POSTGRES_PASSWORD=" .env | head -n1 | cut -d= -f2- | wc -c)
    (( pw_len > 16 )) \
      || fail "POSTGRES_PASSWORD is too short for production (16+ characters required)"
  fi

  case "$site_url" in
    *"$expected_path") ;;
    *) fail "VITE_PUBLIC_URL ($site_url) does not end at VITE_APP_BASE_PATH ($base_path)." ;;
  esac

  ok ".env has the required values (base path $base_path)"
}

preflight() {
  info "Pre-flight"

  command -v docker >/dev/null || fail "docker is not installed"
  docker compose version >/dev/null 2>&1 || fail "docker compose v2 is not available"
  [[ -f .env ]] || fail ".env not found. Copy .env.example and fill it in."
  require_env

  # Size is not the test. A deck is published only if it matches the approved
  # SHA256 in backend/app/core/presentations.py, so ask that code directly
  # rather than counting files.
  local decks
  decks=$(find data/presentations -maxdepth 1 -name '*.pdf' 2>/dev/null | wc -l)
  if (( decks == 0 )); then
    warn "No presentation PDFs in data/presentations/ — every deck will show as unpublished."
  else
    ok "$decks presentation PDF(s) on disk (integrity is verified at runtime)"
  fi
}

# ---------------------------------------------------------------- deploy
build_and_start() {
  info "Building images"
  docker compose build

  info "Starting database"
  docker compose up -d postgres

  info "Applying database migrations"
  # Migrations run before the API starts. Alembic is the sole owner of the
  # production schema; a migration failure must abort the deployment.
  docker compose run --rm backend alembic upgrade head

  info "Starting application services"
  docker compose up -d --remove-orphans backend nginx
}

wait_for_health() {
  info "Waiting for the API"
  for _ in $(seq 1 30); do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      ok "API is responding"
      return 0
    fi
    sleep 2
  done
  fail "API did not become healthy. Run 'docker compose logs backend'."
}

# ---------------------------------------------------------------- verify
verify() {
  info "Verifying"

  curl -fsS "${BASE_URL}/api/health" >/dev/null && ok "GET /api/health"

  # The presentation routes are the product; they shipped broken once because
  # nothing checked them after deploy.
  local manifest
  manifest=$(curl -fsS "${BASE_URL}/api/presentations") || fail "GET /api/presentations failed"
  echo "$manifest" | grep -q '"available"' || fail "manifest response looks wrong"
  ok "GET /api/presentations"

  local available
  available=$(printf '%s' "$manifest" | grep -o '"available":true' | wc -l)
  ok "$available of 4 presentations published"

  if (( available > 0 )); then
    local slug status
    for slug in caspel erp pms irissea; do
      printf '%s' "$manifest" | grep -q "\"${slug}\":{[^}]*\"available\":true" || continue

      status=$(curl -s -o /dev/null -w '%{http_code}' \
        -H 'Range: bytes=0-1023' "${BASE_URL}/api/presentations/${slug}/stream")
      [[ "$status" == "206" ]] \
        || fail "Range request for '${slug}' returned ${status}, expected 206"
      ok "byte-range streaming works for '${slug}'"
      break
    done
  fi

  # Readiness is the real gate: database, pgvector, a live AI provider, mock
  # mode off, and every approved deck present in the corpus with embeddings.
  local ready_status
  ready_status=$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/ready")
  [[ "$ready_status" == "200" ]] \
    || fail "/api/ready returned ${ready_status}. Inspect it: curl -s ${BASE_URL}/api/ready"
  ok "GET /api/ready reports ready"

  # Surfaces that must stay removed. A booth site reachable by QR code from a
  # public hall carries no login form, no telemetry screen, and no
  # filename-addressed PDF route that skips integrity verification.
  local gone_status path
  for path in /api/admin/login /api/admin/leads /api/admin/stats; do
    gone_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}${path}")
    [[ "$gone_status" == "404" ]] \
      || fail "${path} returned ${gone_status}, expected 404 — an admin surface is back"
  done
  gone_status=$(curl -s -o /dev/null -w '%{http_code}' \
    "${BASE_URL}/presentations/CASPEL_Corporate_Presentation.pdf")
  [[ "$gone_status" == "404" ]] \
    || fail "the unverified /presentations/{filename} route returned ${gone_status}, expected 404"
  ok "removed surfaces stay removed"

  # The container serves the SPA at its own root in both modes; the public
  # prefix, if any, is added by the host proxy.
  curl -fsS "${BASE_URL}/" >/dev/null && ok "SPA is served"
}

# ------------------------------------------------------------------ main
if $CHECK_ONLY; then
  verify
  info "Checks passed."
  exit 0
fi

preflight
build_and_start
wait_for_health
verify

cat <<'DONE'

Deployed.

Remaining manual steps, if this is a first install:
  1. Ingest the approved decks:
       docker compose exec -T backend python scripts/ingest_documents.py
  2. sudo cp deploy/nginx/caspel-ciftis.conf /etc/nginx/sites-available/
     and replace ciftis.caspel.com with the real hostname
  3. sudo certbot --nginx -d <hostname>
  4. sudo cp deploy/caspel-ciftis.service /etc/systemd/system/
     sudo systemctl daemon-reload && sudo systemctl enable --now caspel-ciftis
  5. Test the production URL on a real phone before printing the QR code

See deploy/RUNBOOK.md for the full procedure.
DONE
