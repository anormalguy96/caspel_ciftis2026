#!/usr/bin/env bash
#
# Build the CASPEL CIFTIS 2026 release archive.
#
#   ./deploy/collect_release.sh [output-directory]
#   ./deploy/collect_release.sh --dry-run     stage and scan, write nothing
#
# The previous archive was assembled by excluding what someone remembered to
# exclude, and it shipped with .backups/chrome-profile* inside it — browser
# history, cookies and site databases from a QA session, handed to whoever
# received the release.
#
# This collector inverts that: nothing is included unless it appears in the
# allowlist below. A forbidden-path scan then runs over the finished archive,
# and a hit deletes the archive rather than warning about it. An allowlist that
# is only checked at the end is a denylist wearing a costume; both run here.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=true; shift; fi
OUT_DIR="${1:-$(cd .. && pwd)/caspel-releases}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="caspel-ciftis-2026_${STAMP}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m  ok\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m  XX\033[0m %s\n' "$1" >&2; exit 1; }

# --------------------------------------------------------------- allowlist
# Exactly what a deployment needs. Nothing else is copied.
INCLUDE_PATHS=(
  "README.md"
  "ARCHITECTURE.md"
  "implementation.md"
  ".env.example"
  ".gitattributes"
  ".gitignore"
  "docker-compose.yml"
  "nginx/nginx.conf"
  "backend/Dockerfile"
  "backend/alembic.ini"
  "backend/pytest.ini"
  "backend/requirements.in"
  "backend/requirements.txt"
  "backend/requirements-dev.txt"
  "backend/alembic"
  "backend/app"
  "backend/scripts"
  "backend/tests"
  "frontend/Dockerfile"
  "frontend/index.html"
  "frontend/package.json"
  "frontend/package-lock.json"
  "frontend/tsconfig.json"
  "frontend/tsconfig.node.json"
  "frontend/vite.config.ts"
  "frontend/public"
  "frontend/src"
  "frontend/scripts"
  "deploy"
  "data/presentations"
  "docs"
)

# Anything matching these must never reach an archive, whatever the allowlist
# picked up underneath a directory.
FORBIDDEN_PATTERNS=(
  '(^|/)\.env$'
  '(^|/)\.env\.'
  '(^|/)\.backups(/|$)'
  '(^|/)\.claude(/|$)'
  '(^|/)\.agents(/|$)'
  '(^|/)\.codex(/|$)'
  '(^|/)\.git(/|$)'
  '(^|/)node_modules(/|$)'
  '(^|/)dist(/|$)'
  '(^|/)build(/|$)'
  '(^|/)__pycache__(/|$)'
  '(^|/)\.pytest_cache(/|$)'
  '(^|/)\.venv'
  '(^|/)venv(/|$)'
  '(^|/)chrome-profile'
  '(^|/)Default(/|$)'
  '(^|/)Local State$'
  '(^|/)Cookies$'
  '(^|/)History$'
  '(^|/)Login Data$'
  '(^|/)Web Data$'
  '\.sqlite3?$'
  '\.ldb$'
  '\.log$'
  '\.pyc$'
  '\.tsbuildinfo$'
  '\.tar\.gz$'
  '\.tgz$'
  '\.zip$'
  '\.sql$'
  '\.sql\.gz$'
  '\.pem$'
  '\.key$'
  '(^|/)id_rsa'
)

# --------------------------------------------------------------- preflight
REGISTRY="backend/app/core/presentations.py"

info "Verifying the approved presentation decks against $REGISTRY"
# The archive carries the decks, so their integrity is a release gate rather
# than a nice-to-have — shipping a recompressed deck is what this whole pass
# exists to prevent.
#
# The expected values are read straight out of the registry with sed instead of
# importing the application, so this runs on a bare deploy host with no
# virtualenv and no installed dependencies. Size and SHA256 are the whole test:
# identical bytes necessarily have the identical page count, so nothing is lost
# by not parsing the PDF here.
[[ -f "$REGISTRY" ]] || fail "$REGISTRY not found"

DECK_FAILURES=0
DECKS_CHECKED=0

# Each registered entry is a PresentationSpec(...) block carrying a filename,
# a 64-hex sha256 and a size. Unregistered decks have sha256=None and are
# skipped, which is correct: they are not part of the release.
while IFS='|' read -r filename expected_sha expected_size; do
  [[ -n "$filename" ]] || continue
  DECKS_CHECKED=$((DECKS_CHECKED + 1))
  target="data/presentations/$filename"

  if [[ ! -f "$target" ]]; then
    printf '  !!  %s — missing\n' "$filename" >&2
    DECK_FAILURES=$((DECK_FAILURES + 1))
    continue
  fi

  actual_size="$(stat -c%s "$target")"
  actual_sha="$(sha256sum "$target" | cut -d' ' -f1)"

  if [[ "$actual_size" != "$expected_size" ]]; then
    printf '  !!  %s — size %s, expected %s\n' "$filename" "$actual_size" "$expected_size" >&2
    DECK_FAILURES=$((DECK_FAILURES + 1))
  elif [[ "$actual_sha" != "$expected_sha" ]]; then
    printf '  !!  %s — sha256 mismatch\n' "$filename" >&2
    printf '        expected %s\n' "$expected_sha" >&2
    printf '        actual   %s\n' "$actual_sha" >&2
    DECK_FAILURES=$((DECK_FAILURES + 1))
  else
    printf '  ok  %s  %s bytes  %s\n' "$filename" "$actual_size" "$actual_sha"
  fi
done < <(
  sed -n 's/^ *filename="\([^"]*\)".*/F \1/p; s/^ *sha256="\([0-9a-f]\{64\}\)".*/S \1/p; s/^ *size_bytes=\([0-9]\+\),.*/Z \1/p' "$REGISTRY" \
  | awk '
      $1=="F" { f=$2; s=""; z="" ; next }
      $1=="S" { s=$2; next }
      $1=="Z" { z=$2; if (f!="" && s!="") print f "|" s "|" z; f=""; s=""; z=""; next }
    '
)

(( DECKS_CHECKED > 0 )) || fail "No registered decks were found in $REGISTRY — the parse failed."
(( DECK_FAILURES == 0 )) || fail "$DECK_FAILURES deck(s) failed integrity verification. Refusing to build a release."
ok "$DECKS_CHECKED approved deck(s) verified byte-for-byte"

# --------------------------------------------------------------- stage
info "Staging the allowlisted paths"
DEST="$STAGE/$NAME"
mkdir -p "$DEST"

for path in "${INCLUDE_PATHS[@]}"; do
  if [[ ! -e "$path" ]]; then
    printf '  --  skipped (absent): %s\n' "$path"
    continue
  fi
  mkdir -p "$DEST/$(dirname "$path")"
  cp -a "$path" "$DEST/$(dirname "$path")/"
done

# Prune anything the allowlist swept up from inside an included directory.
find "$DEST" \( \
  -name '__pycache__' -o -name '.pytest_cache' -o -name 'node_modules' \
  -o -name 'dist' -o -name '.venv*' -o -name '*.pyc' -o -name '*.log' \
  -o -name '*.tsbuildinfo' -o -name '.DS_Store' \
  \) -prune -exec rm -rf {} + 2>/dev/null || true
ok "staged $(find "$DEST" -type f | wc -l) file(s)"

# --------------------------------------------------------------- scan
info "Scanning for forbidden content"

# The one deliberate exception: .env.example is the committed template and
# holds no values. Every other .env* is a secrets file. Listing it explicitly
# keeps the `.env.` pattern strict rather than loosening it into something that
# would also let a real .env.production through.
is_allowed_exception() {
  [[ "$1" == ".env.example" ]]
}

VIOLATIONS=0
while IFS= read -r file; do
  rel="${file#"$DEST"/}"
  is_allowed_exception "$rel" && continue
  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    if [[ "$rel" =~ $pattern ]]; then
      printf '  !!  FORBIDDEN: %s (matched %s)\n' "$rel" "$pattern" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done < <(find "$DEST" -type f)

if (( VIOLATIONS )); then
  fail "$VIOLATIONS forbidden path(s) staged. Nothing was written."
fi
ok "no forbidden paths"

# A secret can also sit inside an allowlisted file.
info "Scanning file contents for credentials"
if grep -rIlE '(AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' "$DEST" 2>/dev/null; then
  fail "A live-looking credential was found in the staged tree. Nothing was written."
fi
ok "no credential patterns in file contents"

# --------------------------------------------------------------- archive
if $DRY_RUN; then
  echo ""
  echo "Dry run: the staged tree passed every gate. Nothing was written."
  echo "Staged files : $(find "$DEST" -type f | wc -l)"
  echo "Staged bytes : $(du -sb "$DEST" | cut -f1)"
  exit 0
fi

info "Writing the archive"
mkdir -p "$OUT_DIR"
ARCHIVE="$OUT_DIR/${NAME}.tar.gz"
tar -C "$STAGE" -czf "$ARCHIVE" "$NAME"

CHECKSUM="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
printf '%s  %s\n' "$CHECKSUM" "${NAME}.tar.gz" > "${ARCHIVE}.sha256"

echo ""
echo "Archive : $ARCHIVE"
echo "Bytes   : $(stat -c%s "$ARCHIVE")"
echo "SHA256  : $CHECKSUM"
echo "Files   : $(tar -tzf "$ARCHIVE" | grep -vc '/$')"
echo ""
echo "Verify the contents before sending it on:"
echo "  tar -tzf \"$ARCHIVE\" | less"
