"""Render the first slide of each approved presentation to a preview image.

Why this exists
---------------

The viewer cannot show a slide quickly. Page one of the Corporate deck is 1.7 MB
of its own bytes and page one of the ERP deck is 1.5 MB, which is a 7-8 second
transfer floor on the documented throttled-mobile profile before a single
request is made. No delivery tuning beats arithmetic: byte ranges, chunk sizes
and linearization were all measured and none of them helped.

A WebP of the same page is about 50 KB and lands in well under a second, so the
visitor sees the real first slide almost immediately while PDF.js starts behind
it.

What makes this safe
--------------------

The preview is a *render of the approved PDF*, never artwork. There is no
retouching, no overlay and no substitute imagery, so what a visitor sees first
is what the deck actually says.

Provenance is enforced rather than documented. The source is verified against
the SHA256 recorded in app.core.presentations -- the same digest the API refuses
to serve without -- so a swapped, corrupted or unapproved PDF fails here instead
of quietly replacing an approved asset with a render of something else.

The input is opened read-only and never written. Output goes to a separate
directory and is only touched for slugs whose source verified.

Adding PMS or IRISSEA later needs no change here: register the real digest in
app.core.presentations and rerun.

Usage
-----

    python -m scripts.build_slide_previews            # write previews
    python -m scripts.build_slide_previews --check    # verify, write nothing
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, "/app")

#: Width in CSS pixels. The viewer never displays a slide wider than this on the
#: devices this serves, and doubling it quadruples the bytes for detail nobody
#: sees.
PREVIEW_WIDTH = 1080

#: Measured against the approved decks: q80 WebP scored higher objective
#: similarity than JPEG q86 at half the size, and side-by-side inspection at 1:1
#: showed no visible loss in small text, logo edges or the dark gradients where
#: banding would appear first.
PREVIEW_QUALITY = 80

#: Page one. Named rather than inlined so the intent is not mistaken for an
#: index bug.
PREVIEW_PAGE = 1

OUTPUT_DIR = Path("/out")
MANIFEST_NAME = "previews.json"


def render_preview(pdf_path: Path) -> tuple[bytes, int, int]:
    """Render page one to WebP. Returns (bytes, width, height)."""
    import fitz  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    doc = fitz.open(pdf_path)
    try:
        page = doc[PREVIEW_PAGE - 1]
        scale = PREVIEW_WIDTH / page.rect.width
        # alpha=False: a transparent background would composite against whatever
        # the viewer happens to sit on, which is not what the slide looks like.
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    finally:
        doc.close()

    buffer = io.BytesIO()
    # Pillow writes no EXIF unless asked, so the output carries no metadata.
    image.save(buffer, format="WEBP", quality=PREVIEW_QUALITY, method=6)
    return buffer.getvalue(), image.width, image.height


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify sources and existing outputs; write nothing",
    )
    args = parser.parse_args()

    from app.core.presentations import (  # noqa: PLC0415
        PRESENTATIONS,
        file_sha256,
        resolve_path,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    failures: list[str] = []
    wrote = 0

    for slug, spec in PRESENTATIONS.items():
        if not spec.is_registered:
            print(f"  {slug:<10} skipped - no approved file registered")
            continue

        path: Optional[Path] = resolve_path(slug)
        if path is None or not path.exists():
            failures.append(f"{slug}: approved file not found")
            continue

        actual = file_sha256(path)
        if actual != spec.sha256:
            # The whole point of this check. A preview rendered from an
            # unexpected file would look authoritative and be wrong.
            failures.append(
                f"{slug}: source SHA256 mismatch\n"
                f"      expected {spec.sha256}\n"
                f"      actual   {actual}"
            )
            continue

        data, width, height = render_preview(path)
        digest = hashlib.sha256(data).hexdigest()
        out_path = OUTPUT_DIR / f"{slug}-slide-1.webp"

        entry = {
            "slug": slug,
            "source_file": spec.filename,
            "source_sha256": spec.sha256,
            "source_page": PREVIEW_PAGE,
            "width": width,
            "height": height,
            "bytes": len(data),
            "sha256": digest,
            "quality": PREVIEW_QUALITY,
            "format": "webp",
        }
        manifest[slug] = entry

        if args.check:
            if not out_path.exists():
                failures.append(f"{slug}: {out_path.name} is missing")
            else:
                existing = hashlib.sha256(out_path.read_bytes()).hexdigest()
                if existing != digest:
                    failures.append(
                        f"{slug}: {out_path.name} does not match a fresh render\n"
                        f"      committed {existing}\n"
                        f"      rendered  {digest}"
                    )
                else:
                    print(f"  {slug:<10} OK  {width}x{height}  {len(data):,} B  {digest[:16]}")
        else:
            out_path.write_bytes(data)
            wrote += 1
            print(f"  {slug:<10} {out_path.name}  {width}x{height}  {len(data):,} B  {digest[:16]}")

    if not args.check and manifest:
        (OUTPUT_DIR / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    if failures:
        print("\n  FAILED:")
        for f in failures:
            print(f"    {f}")
        return 1

    print(f"\n  {'verified' if args.check else 'wrote'} {len(manifest)} preview(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
