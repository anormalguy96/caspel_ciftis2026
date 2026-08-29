#!/usr/bin/env python3
"""
Generate the static brand assets that live in public/.

  public/og-image.png          1200x630 social share card
  public/apple-touch-icon.png  180x180 iOS home-screen icon

Both are committed, so a production build never depends on this script running.
Re-run it only when the brand artwork or the wording changes.

Requires Pillow and PyMuPDF (both in backend/requirements.txt):
    ../backend/.venv/bin/python scripts/generate_brand_assets.py
"""
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
PUBLIC = ROOT / "public"
LOGO_PDF = REPO / "docs" / "Caspel Logo Horizontal.pdf"

# CASPEL brand palette — keep in step with src/styles/tokens.css
DARK = (6, 48, 68)
GREEN = (81, 183, 72)
WHITE = (255, 255, 255)
MUTED = (150, 176, 190)

BOLD_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
REGULAR_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def load_font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_og_image() -> Path:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), DARK)
    draw = ImageDraw.Draw(image)

    draw.rectangle([(0, 0), (12, height)], fill=GREEN)  # brand rule

    title = load_font(BOLD_FONTS, 74)
    left = 90

    draw.text((left, 110), "CIFTIS 2026  ·  BEIJING", font=load_font(BOLD_FONTS, 26), fill=GREEN)
    draw.text((left, 176), "CASPEL", font=title, fill=WHITE)
    draw.text((left, 268), "Enterprise Technology", font=title, fill=WHITE)
    draw.text((left, 360), "Solutions", font=title, fill=WHITE)
    draw.text(
        (left, 474),
        "Caspel ERP  ·  Procurement Management  ·  IRISSEA LRIT",
        font=load_font(REGULAR_FONTS, 32),
        fill=MUTED,
    )
    draw.line([(left, 542), (width - 90, 542)], fill=MUTED, width=1)
    draw.text((left, 566), "caspel.com", font=load_font(REGULAR_FONTS, 26), fill=MUTED)

    out = PUBLIC / "og-image.png"
    image.save(out, "PNG", optimize=True)
    return out


def load_logo() -> Image.Image:
    """The full horizontal lockup, trimmed to its artwork."""
    with pymupdf.open(str(LOGO_PDF)) as doc:
        pix = doc[0].get_pixmap(dpi=900, alpha=True)
    logo = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    bbox = logo.getbbox()
    return logo.crop(bbox) if bbox else logo


def extract_symbol(logo: Image.Image) -> Image.Image:
    """
    Isolate the CASPEL mark from the wordmark.

    A square icon needs the symbol alone — the full horizontal lockup shrinks to
    an illegible smear at 180px. The split point is the first wide run of fully
    transparent columns, i.e. the gap before the letters.
    """
    alpha = logo.split()[3]
    min_gap = logo.width * 0.02
    run = 0
    gap_start = None

    for x in range(logo.width):
        column_empty = alpha.crop((x, 0, x + 1, logo.height)).getbbox() is None
        if column_empty:
            run += 1
            if run > min_gap and gap_start is None:
                gap_start = x - run + 1
        else:
            if gap_start is not None:
                break
            run = 0

    symbol = logo.crop((0, 0, gap_start or logo.width, logo.height))
    bbox = symbol.getbbox()
    return symbol.crop(bbox) if bbox else symbol


def build_touch_icon() -> Path:
    size = 180
    symbol = extract_symbol(load_logo())

    target = int(size * 0.62)
    ratio = min(target / symbol.width, target / symbol.height)
    symbol = symbol.resize(
        (max(1, int(symbol.width * ratio)), max(1, int(symbol.height * ratio))), Image.LANCZOS
    )

    # The artwork is dark-on-transparent; recolour to white for the dark tile.
    white = Image.new("RGBA", symbol.size, (255, 255, 255, 255))
    white.putalpha(symbol.split()[3])

    tile = Image.new("RGB", (size, size), DARK)
    tile.paste(white, ((size - white.width) // 2, (size - white.height) // 2), white)

    out = PUBLIC / "apple-touch-icon.png"
    tile.save(out, "PNG", optimize=True)
    return out


def main() -> int:
    if not LOGO_PDF.exists():
        print(f"Brand artwork not found: {LOGO_PDF}")
        return 1

    PUBLIC.mkdir(parents=True, exist_ok=True)
    for path in (build_og_image(), build_touch_icon()):
        with Image.open(path) as img:
            print(f"Wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes, {img.width}x{img.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
