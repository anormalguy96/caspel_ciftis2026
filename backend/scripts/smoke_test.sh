#!/usr/bin/env bash
#
# Post-deploy smoke test for the CASPEL CIFTIS 2026 stack.
#
# Read-only by default. The previous version inserted a fake lead named after a
# real person and an analytics event on every run, so each smoke test polluted
# the exhibition's own lead table. Pass --include-mutating to exercise the write
# paths deliberately, and only against a non-production database.
#
# Nothing here is ever reported as passing when it was skipped or failed.

set -uo pipefail

BASE_URL=${BASE_URL:-http://127.0.0.1:${APP_HTTP_PORT:-8080}}
INCLUDE_MUTATING=0
[[ "${1:-}" == "--include-mutating" ]] && INCLUDE_MUTATING=1

PASSED=0
FAILED=0
SKIPPED=0

pass() { echo "  STATUS: PASSED  $1"; PASSED=$((PASSED + 1)); }
skip() { echo "  STATUS: SKIPPED $1"; SKIPPED=$((SKIPPED + 1)); }
fail() { echo "  STATUS: FAILED  $1"; FAILED=$((FAILED + 1)); }

# ---------------------------------------------------------------------------
echo "=== 1. HEALTH (liveness) ==="
BODY=$(curl -sS -m 10 -w '\n%{http_code}' "${BASE_URL}/api/health")
CODE=$(tail -n1 <<<"$BODY"); BODY=$(sed '$d' <<<"$BODY")
if [[ "$CODE" != "200" ]]; then
  fail "expected 200, got $CODE"
elif [[ "$BODY" != *'"status":"healthy"'* ]]; then
  fail "expected status=healthy, got: $BODY"
elif [[ "$BODY" == *app_env* || "$BODY" == *postgres* || "$BODY" == *gemini* ]]; then
  fail "health response leaks operational detail: $BODY"
else
  pass "$BODY"
fi

# ---------------------------------------------------------------------------
echo "=== 2. READINESS ==="
BODY=$(curl -sS -m 20 -w '\n%{http_code}' "${BASE_URL}/api/ready")
CODE=$(tail -n1 <<<"$BODY"); BODY=$(sed '$d' <<<"$BODY")
echo "  body: $BODY"
if [[ "$CODE" == "200" && "$BODY" == *'"status":"ready"'* ]]; then
  pass "ready"
else
  # A 503 here is a real, reportable result: the stack is up but not serving.
  fail "not ready (HTTP $CODE)"
fi

# ---------------------------------------------------------------------------
echo "=== 3. PRESENTATION MANIFEST ==="
MANIFEST=$(curl -sS -m 15 -w '\n%{http_code}' "${BASE_URL}/api/presentations")
CODE=$(tail -n1 <<<"$MANIFEST"); MANIFEST=$(sed '$d' <<<"$MANIFEST")
if [[ "$CODE" != "200" ]]; then
  fail "manifest returned HTTP $CODE"
  MANIFEST=""
else
  pass "manifest served"
fi

# ---------------------------------------------------------------------------
# Range checks against the real streaming route. /presentations/{filename} no
# longer exists: it bypassed integrity verification entirely.
check_range() {
  local slug="$1"
  echo "=== RANGE STREAM: /api/presentations/${slug}/stream (bytes=0-1023) ==="

  if [[ "$MANIFEST" != *"\"${slug}\""* ]]; then
    skip "${slug} absent from manifest"
    return
  fi
  if ! grep -qE "\"${slug}\"[^}]*\"available\":true" <<<"$MANIFEST"; then
    skip "${slug} is not published (available=false)"
    return
  fi

  local headers body status ctype crange total size prefix
  headers=$(mktemp); body=$(mktemp)

  if ! curl -sS -m 30 -D "$headers" -o "$body" \
       -H "Range: bytes=0-1023" "${BASE_URL}/api/presentations/${slug}/stream"; then
    rm -f "$headers" "$body"; fail "${slug}: request failed"; return
  fi

  status=$(head -n1 "$headers" | tr -d '\r')
  ctype=$(grep -i '^content-type:' "$headers" | tr -d '\r' | head -n1)
  crange=$(grep -i '^content-range:' "$headers" | tr -d '\r' | head -n1)
  size=$(wc -c < "$body" | tr -d ' ')
  prefix=$(head -c 5 "$body")
  total=$(sed -E 's|.*/([0-9]+).*|\1|' <<<"$crange")

  echo "  $status"
  echo "  $ctype"
  echo "  $crange"
  echo "  body bytes: $size, prefix: $prefix"

  local problem=""
  [[ "$status" == *206* ]]                          || problem="no 206 Partial Content"
  [[ "$ctype" == *application/pdf* ]]               || problem="${problem:-} content-type not application/pdf"
  grep -qi '^accept-ranges: *bytes' "$headers"      || problem="${problem:-} missing Accept-Ranges: bytes"
  [[ "$crange" =~ bytes\ 0-1023/[0-9]+ ]]           || problem="${problem:-} invalid Content-Range"
  [[ "$size" == "1024" ]]                           || problem="${problem:-} body is $size bytes, expected exactly 1024"
  [[ "$prefix" == "%PDF-" ]]                        || problem="${problem:-} missing %PDF- prefix"
  [[ -n "$total" && "$total" -gt 100000 ]]          || problem="${problem:-} implausible total size ${total:-unknown}"

  rm -f "$headers" "$body"
  if [[ -n "$problem" ]]; then fail "${slug}: $problem"; else pass "${slug}: 206, application/pdf, 1024 bytes, %PDF-"; fi
}

check_range "caspel"
check_range "erp"

# ---------------------------------------------------------------------------
echo "=== 6. SPA ROUTES ==="
for route in /ciftis /ciftis/display /ciftis/product/erp /ciftis/presentation/caspel; do
  CODE=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${BASE_URL}${route}")
  if [[ "$CODE" == "200" ]]; then pass "$route -> 200"; else fail "$route -> $CODE"; fi
done

echo "=== 7. REMOVED SURFACES STAY REMOVED ==="
for route in /ciftis/admin /ciftis/status; do
  # The SPA serves index.html for unknown paths, so a 200 here is the shell
  # rendering its 404 page. What matters is that the API behind them is gone.
  :
done
for api in /api/admin/login /api/admin/stats /api/admin/leads; do
  CODE=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}${api}")
  if [[ "$CODE" == "404" ]]; then pass "$api -> 404 (removed)"; else fail "$api -> $CODE (expected 404)"; fi
done
CODE=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "${BASE_URL}/presentations/CASPEL_Corporate_Presentation.pdf")
if [[ "$CODE" == "404" ]]; then pass "unverified filename route -> 404"; else fail "unverified filename route -> $CODE"; fi

# ---------------------------------------------------------------------------
if [[ "$INCLUDE_MUTATING" == "1" ]]; then
  echo "=== 8. LEAD SUBMISSION (mutating) ==="
  BODY=$(curl -sS -m 15 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"name":"Smoke Test","company":"Smoke Test","business_email":"smoke-test@example.invalid","interest":"general"}' \
    "${BASE_URL}/api/leads")
  CODE=$(tail -n1 <<<"$BODY"); BODY=$(sed '$d' <<<"$BODY")
  if [[ "$CODE" == "201" && "$BODY" == *'"success":true'* ]]; then pass "lead accepted"; else fail "HTTP $CODE: $BODY"; fi

  echo "=== 9. ANALYTICS EVENT (mutating) ==="
  BODY=$(curl -sS -m 15 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke_test","event_name":"SMOKE_TEST"}' "${BASE_URL}/api/events")
  CODE=$(tail -n1 <<<"$BODY"); BODY=$(sed '$d' <<<"$BODY")
  if [[ "$CODE" == "201" ]]; then pass "event accepted"; else fail "HTTP $CODE: $BODY"; fi

  echo "=== 10. CASPEL AI (mutating, live provider) ==="
  BODY=$(curl -sS -m 60 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke_test","message":"What is Caspel ERP?"}' "${BASE_URL}/api/chat")
  CODE=$(tail -n1 <<<"$BODY"); BODY=$(sed '$d' <<<"$BODY")
  if [[ "$CODE" == "503" ]]; then
    fail "CASPEL AI reported itself unavailable (503)"
  elif [[ "$CODE" != "200" ]]; then
    fail "HTTP $CODE"
  elif [[ "$BODY" == *'"sources":[]'* ]]; then
    fail "answered with no grounded sources"
  else
    pass "answered with citations"
  fi
else
  echo "=== 8-10. MUTATING CHECKS ==="
  skip "lead / event / chat write paths (pass --include-mutating to run them)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== SMOKE TEST SUMMARY ==="
echo "PASSED:  $PASSED"
echo "FAILED:  $FAILED"
echo "SKIPPED: $SKIPPED"

[[ "$FAILED" -gt 0 ]] && exit 1
exit 0
