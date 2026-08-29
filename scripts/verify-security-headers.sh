#!/usr/bin/env bash
#
# Regression check: the security headers must survive on every HTML response.
#
# nginx does not merge add_header sets. A location that declares any add_header
# of its own silently discards every one inherited from the server block, and
# because the SPA fallback internally rewrites deep links to /index.html, a
# cache rule added there once stripped X-Frame-Options from every page on the
# site. Nothing failed, nothing logged; the headers were simply gone. This
# script exists so that regression cannot return unnoticed.
#
# Usage:
#   scripts/verify-security-headers.sh <base-url> [route-prefix]
#
#   Mode A:  scripts/verify-security-headers.sh http://127.0.0.1:8080
#   Mode B:  scripts/verify-security-headers.sh http://127.0.0.1:8080 /ciftis
#
# Exits non-zero on the first missing header.

set -uo pipefail

BASE="${1:?usage: verify-security-headers.sh <base-url> [route-prefix]}"
PREFIX="${2:-}"
BASE="${BASE%/}"
PREFIX="${PREFIX%/}"

# Every HTML entry point: the root, index.html by name, the kiosk display, a
# Page B deep link, and a path that exists only as the SPA not-found fallback.
ROUTES=(
    "/"
    "/index.html"
    "/display"
    "/product/erp"
    "/no-such-page-spa-fallback"
)

REQUIRED_HEADERS=(
    "X-Content-Type-Options: nosniff"
    "X-Frame-Options: DENY"
    "Referrer-Policy: strict-origin-when-cross-origin"
)

failures=0
checks=0

for route in "${ROUTES[@]}"; do
    url="${BASE}${PREFIX}${route}"
    headers="$(curl -sS -o /dev/null -D - "$url" 2>/dev/null | tr -d '\r')"
    status="$(printf '%s\n' "$headers" | awk 'NR==1 {print $2}')"

    if [ -z "$status" ]; then
        printf '  FAIL  %-34s no response\n' "$route"
        failures=$((failures + 1))
        continue
    fi

    for header in "${REQUIRED_HEADERS[@]}"; do
        checks=$((checks + 1))
        name="${header%%:*}"
        if printf '%s\n' "$headers" | grep -qi "^${name}:"; then
            got="$(printf '%s\n' "$headers" | grep -i "^${name}:" | head -1 | sed 's/[[:space:]]*$//')"
            if [ "$(printf '%s' "$got" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$header" | tr '[:upper:]' '[:lower:]')" ]; then
                printf '  PASS  %-34s %s\n' "$route" "$got"
            else
                printf '  FAIL  %-34s %s (expected "%s")\n' "$route" "$got" "$header"
                failures=$((failures + 1))
            fi
        else
            printf '  FAIL  %-34s MISSING %s  [HTTP %s]\n' "$route" "$name" "$status"
            failures=$((failures + 1))
        fi
    done
done

printf '\n  %d/%d header checks passed across %d routes\n' \
    "$((checks - failures))" "$checks" "${#ROUTES[@]}"

if [ "$failures" -ne 0 ]; then
    printf '  RESULT: FAIL — %d missing or incorrect header(s)\n' "$failures"
    exit 1
fi

printf '  RESULT: PASS\n'
