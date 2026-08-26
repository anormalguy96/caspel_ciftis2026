"""
The registry of genuine CASPEL presentation decks, and the integrity check
every route and the ingestion script run before treating a file as one.

Why a hash and not just "a big file starting with %PDF-":

The previous check accepted any file over 100 KB whose first five bytes were
`%PDF-`. That passed a recompressed copy of the Corporate deck, and it would
pass an unrelated PDF dropped into the mount by mistake. What this site
publishes at an exhibition, and what CASPEL AI quotes back to visitors as
CASPEL's own material, has to be byte-for-byte the file CASPEL approved — not
something that merely resembles it.

A slug with no registered expectation can never become available. That is
deliberate: PMS and IRISSEA have not been supplied, and the failure mode of a
looser rule is publishing the wrong document under a CASPEL product name.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

# Read in chunks so a 24 MB deck is never held in memory twice.
_HASH_CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class PresentationSpec:
    """What a genuine deck for this slug must be."""

    slug: str
    name: str
    filename: str
    product: str
    #: Exact SHA256 of the approved file. None means no approved file exists
    #: yet, so the slug is listed but can never be published.
    sha256: Optional[str]
    #: Exact page count of the approved file.
    page_count: Optional[int]
    #: Exact size in bytes of the approved file.
    size_bytes: Optional[int]

    @property
    def is_registered(self) -> bool:
        return bool(self.sha256 and self.page_count and self.size_bytes)


PRESENTATIONS: Dict[str, PresentationSpec] = {
    "caspel": PresentationSpec(
        slug="caspel",
        name="CASPEL Corporate Presentation",
        filename="CASPEL_Corporate_Presentation.pdf",
        product="caspel",
        sha256="051796d6e7e6f9243739b2985a0d8d04525e55d8ef6067ba78aa3aa9e1811f03",
        page_count=24,
        size_bytes=24433969,
    ),
    "erp": PresentationSpec(
        slug="erp",
        name="CASPEL ERP Presentation",
        filename="CASPEL_ERP_Presentation.pdf",
        product="erp",
        sha256="e7033d04ff59141572ffd4cdd57163c031d7faa39052c51e29424dd0cf50aab7",
        page_count=41,
        size_bytes=5480032,
    ),
    # Awaiting genuine client files. Listed so the site can say honestly that
    # the product exists and the deck is not published yet.
    "pms": PresentationSpec(
        slug="pms",
        name="CASPEL PMS Presentation",
        filename="CASPEL_PMS_Presentation.pdf",
        product="pms",
        sha256=None,
        page_count=None,
        size_bytes=None,
    ),
    "irissea": PresentationSpec(
        slug="irissea",
        name="IRISSEA LRIT Presentation",
        filename="IRISSEA_LRIT_Presentation.pdf",
        product="irissea",
        sha256=None,
        page_count=None,
        size_bytes=None,
    ),
}

#: Slugs that have an approved file and are therefore eligible for ingestion.
REGISTERED_SLUGS: Tuple[str, ...] = tuple(
    slug for slug, spec in PRESENTATIONS.items() if spec.is_registered
)


@dataclass(frozen=True)
class IntegrityResult:
    """Outcome of checking one file against its spec."""

    ok: bool
    reason: Optional[str]
    path: Optional[Path]
    size_bytes: Optional[int]
    sha256: Optional[str]
    page_count: Optional[int]


def _fail(reason: str, **fields) -> IntegrityResult:
    return IntegrityResult(ok=False, reason=reason, **{
        "path": None, "size_bytes": None, "sha256": None, "page_count": None, **fields
    })


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(_HASH_CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_path(slug: str) -> Optional[Path]:
    """
    Map an allowlisted slug to a path inside the presentations directory.

    Returns None for an unknown slug or for any path that escapes the base
    directory. Containment is checked with relative_to after resolve():
    startswith() would accept a sibling such as /data/presentations-backup.
    """
    spec = PRESENTATIONS.get(slug.strip().lower())
    if spec is None:
        return None

    base_dir = settings.presentations_dir
    candidate = (base_dir / spec.filename).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError:
        logger.error("Resolved path for slug %s escaped the presentations directory", slug)
        return None
    return candidate


# Verification is expensive (a full SHA256 over 24 MB plus a PDF parse), so the
# result is cached on the file's identity. Replacing the file changes its size
# or mtime and invalidates the entry, so a corrected deck is picked up without
# a restart — while a steady state costs nothing per request.
_cache: Dict[tuple, IntegrityResult] = {}


def clear_cache() -> None:
    """Test seam."""
    _cache.clear()


def verify(slug: str) -> IntegrityResult:
    """
    Full integrity check for one slug.

    A file is genuine only if ALL of these hold:
      · the slug is allowlisted and has a registered approved file;
      · the resolved path stays inside the presentations directory;
      · the file exists, is a regular file, and is non-empty;
      · its size matches the approved size exactly;
      · its SHA256 matches the approved digest exactly;
      · it parses as a PDF;
      · its page count matches the approved page count exactly.
    """
    clean_slug = slug.strip().lower()
    spec = PRESENTATIONS.get(clean_slug)
    if spec is None:
        return _fail("unknown_slug")
    if not spec.is_registered:
        return _fail("no_approved_file")

    path = resolve_path(clean_slug)
    if path is None:
        return _fail("path_escape")

    try:
        stat = path.stat()
    except OSError:
        return _fail("missing_file")

    if not path.is_file():
        return _fail("not_a_file")
    if stat.st_size == 0:
        return _fail("empty_file")

    key = (str(path), stat.st_size, stat.st_mtime_ns, spec.sha256)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    result = _verify_uncached(spec, path, stat.st_size)
    _cache[key] = result

    if not result.ok:
        # Loud: a mismatch here means the mounted file is not the approved deck.
        logger.error(
            "Presentation %s failed integrity verification (%s); it will not be served.",
            clean_slug,
            result.reason,
        )
    return result


def _verify_uncached(spec: PresentationSpec, path: Path, size: int) -> IntegrityResult:
    if size != spec.size_bytes:
        return _fail("size_mismatch", path=path, size_bytes=size)

    try:
        digest = file_sha256(path)
    except OSError as exc:
        logger.error("Could not read %s while hashing: %s", path, exc)
        return _fail("unreadable", path=path, size_bytes=size)

    if digest != spec.sha256:
        return _fail("sha256_mismatch", path=path, size_bytes=size, sha256=digest)

    page_count = _parse_page_count(path)
    if page_count is None:
        return _fail("pdf_parse_failed", path=path, size_bytes=size, sha256=digest)
    if page_count != spec.page_count:
        return _fail(
            "page_count_mismatch", path=path, size_bytes=size, sha256=digest,
            page_count=page_count,
        )

    return IntegrityResult(
        ok=True, reason=None, path=path, size_bytes=size,
        sha256=digest, page_count=page_count,
    )


def _parse_page_count(path: Path) -> Optional[int]:
    """Page count via a real parse. None means the file is not a usable PDF."""
    try:
        import pymupdf

        with pymupdf.open(str(path)) as doc:
            if doc.is_encrypted and doc.needs_pass:
                logger.warning("%s is password protected", path)
                return None
            return doc.page_count
    except Exception as exc:
        logger.warning("PDF parse failed for %s: %s", path, exc)
        return None


def available_slugs() -> Tuple[str, ...]:
    """Slugs whose on-disk file currently passes verification."""
    return tuple(slug for slug in PRESENTATIONS if verify(slug).ok)


__all__ = [
    "PRESENTATIONS",
    "REGISTERED_SLUGS",
    "PresentationSpec",
    "IntegrityResult",
    "verify",
    "resolve_path",
    "file_sha256",
    "available_slugs",
    "clear_cache",
]
