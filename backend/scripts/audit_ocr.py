"""Read-only OCR quality audit of the indexed corpus.

Reads what is already in the database. It does not touch the protected PDFs,
does not re-extract and does not write.

**This heuristic was rebuilt after the first one proved useless.** The original
counted isolated one- and two-letter capitals as evidence of corruption. On the
Azerbaijani ERP deck that fires constantly on ordinary text, so it flagged 39 of
65 pages while retrieval scored Recall@4 100% on the very cases those pages
answer. A signal that flags 60% of a corpus and predicts nothing is worse than
no signal: it invites a fix to a problem that does not exist.

The replacement looks only for things that cannot be legitimate text:

  * Unicode replacement characters, the unambiguous mark of a decode failure.
  * Control characters that no extractor should emit.
  * Symbol density far above what a slide legitimately contains.
  * A long run repeated verbatim, which is an extraction loop.
  * A page whose own number is stranded at the start, i.e. footer bleed.
  * Text with no word longer than three characters, which is what genuinely
    shattered layout looks like.

Azerbaijani letters, product names and abbreviations are explicitly *not*
suspicious. Pages that are mostly graphics are reported separately from pages
that are broken, because a photo slide with a two-word caption is intact.

    python -m scripts.audit_ocr
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "/app")

#: Legitimate letters. Azerbaijani adds ə ğ ı ş ç ö ü to the Latin set, and Han
#: characters appear in no source document but cost nothing to allow.
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)

#: Characters that are always a decode failure, never content.
_REPLACEMENT = re.compile(r"[�﻿]")

#: Control characters an extractor should never emit. Tab, newline and carriage
#: return are legitimate layout.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

#: Symbols that carry no meaning in a slide's prose.
_NOISE_SYMBOL = re.compile(r"[@©®™|~^`\\<>{}]")


def audit_page(content: str, page: int) -> dict:
    text = content or ""
    words = [w for w in re.split(r"\s+", text) if w]
    letters = len(_LETTER.findall(text))

    replacement = len(_REPLACEMENT.findall(text))
    control = len(_CONTROL.findall(text))

    # Density relative to letters, not to raw length: a short page with two
    # symbols is not noisier than a long page with twenty.
    noise = len(_NOISE_SYMBOL.findall(text))
    noise_density = noise / letters if letters else 0.0

    # A verbatim repeat of a long run is an extraction loop, not prose.
    repeated = False
    if len(text) > 200:
        probe = text[40:100]
        repeated = bool(probe.strip()) and text.count(probe) > 1

    # The page's own number stranded in the first few characters.
    head = text[:24]
    footer_bleed = bool(re.search(rf"(?<!\d){page}(?!\d)", head)) and page > 1

    # Genuinely shattered layout: nothing survives as a real word.
    longest_word = max((len(w) for w in words if _LETTER.match(w)), default=0)
    shattered = bool(words) and longest_word <= 3

    # Mostly-graphics is a property of the slide, not a defect.
    graphics_only = letters < 60

    defects = []
    if replacement:
        defects.append("replacement_characters")
    if control:
        defects.append("control_characters")
    if noise_density > 0.08:
        defects.append("symbol_density")
    if repeated:
        defects.append("repeated_run")
    if footer_bleed:
        defects.append("footer_bleed")
    if shattered:
        defects.append("shattered_words")

    return {
        "page": page,
        "chars": len(text),
        "words": len(words),
        "letters": letters,
        "replacement_characters": replacement,
        "control_characters": control,
        "noise_density": round(noise_density, 4),
        "repeated_run": repeated,
        "footer_bleed": footer_bleed,
        "shattered_words": shattered,
        "graphics_only": graphics_only,
        "defects": defects,
        "longest_word": longest_word,
    }


async def main() -> int:
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.database import AsyncSessionLocal  # noqa: PLC0415
    from app.models.entities import Document, DocumentChunk  # noqa: PLC0415

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(
                    Document.product,
                    DocumentChunk.page_number,
                    DocumentChunk.content,
                )
                .join(Document, DocumentChunk.document_id == Document.id)
                .order_by(Document.product.asc(), DocumentChunk.page_number.asc())
            )
        ).all()

    findings = []
    for row in rows:
        f = audit_page(row.content, int(row.page_number or 0))
        f["product"] = row.product
        findings.append(f)

    defective = [f for f in findings if f["defects"]]
    graphics = [f for f in findings if f["graphics_only"] and not f["defects"]]

    print(f"  pages audited: {len(findings)}")
    print(f"  pages with a real defect signal: {len(defective)}")
    print(f"  pages that are mostly graphics (not a defect): {len(graphics)}")
    print()

    if defective:
        print("  defects:")
        for f in defective:
            print(
                f"    {f['product']}/p{f['page']:<3} {','.join(f['defects']):<40} "
                f"letters={f['letters']:<5} noise={f['noise_density']}"
            )
    else:
        print("  no page shows a signal that cannot be legitimate text.")

    if graphics:
        print("\n  mostly graphics:")
        for f in graphics:
            print(f"    {f['product']}/p{f['page']:<3} letters={f['letters']}")

    # Does any real defect reach a question the evaluation actually asks?
    corpus_path = Path("/app/tests/rag_eval/corpus.json")
    if corpus_path.exists():
        cases = json.loads(corpus_path.read_text(encoding="utf-8"))["cases"]
        suspect = {(f["product"], f["page"]) for f in defective}
        affected = [
            (c["id"], c.get("expect_product"), page)
            for c in cases
            if c.get("answerable")
            for page in (c.get("expect_pages") or [])
            if (c.get("expect_product"), page) in suspect
        ]
        print(f"\n  evaluation cases whose expected page has a real defect: {len(affected)}")
        for cid, product, page in affected[:15]:
            print(f"    {cid:<28} -> {product}/p{page}")
        if not affected:
            print("    none -- no defective page is the expected answer for any case")

    Path("/tmp/ocr_audit.json").write_text(json.dumps(findings, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
