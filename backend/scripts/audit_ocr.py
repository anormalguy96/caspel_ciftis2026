"""Read-only OCR quality audit of the indexed corpus.

Reads what is already in the database. It does not touch the protected PDFs,
does not re-extract and does not write. The point is to establish whether
extraction quality is a real constraint on either architecture, or merely
untidy in ways no visitor question reaches.

A finding here is a *suspicion*, not a proven cause. The last section checks
each flagged page against the evaluation corpus, because a mangled page that
no question targets costs nothing.

    python -m scripts.audit_ocr
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "/app")

#: Official spellings. A near-miss on one of these is what turns a good
#: question into an ungroundable one.
PRODUCT_TERMS = ["CASPEL", "IRISSEA", "LRIT", "CIFTIS", "ERP", "PMS"]

#: Runs of isolated capitals and stray glyphs are what broken slide extraction
#: looks like: "Sil AHEAD OF TIME @CASPEL2 9".
STRAY_GLYPHS = re.compile(r"[@©®™|~^]{1,}|(?<![A-Za-z])[A-Z]{1,2}(?![A-Za-z])")
REPEATED_WS = re.compile(r"\s{3,}")


def audit_page(content: str, page: int) -> dict:
    text = content or ""
    words = [w for w in re.split(r"\s+", text) if w]
    letters = sum(c.isalpha() for c in text)

    stray = STRAY_GLYPHS.findall(text)
    # A high ratio of one- and two-letter fragments is the signature of a slide
    # whose layout was flattened into isolated characters.
    fragments = [w for w in words if len(w) <= 2 and w.isalpha()]
    frag_ratio = len(fragments) / len(words) if words else 0.0

    # Page-number contamination: the page's own number floating alone.
    page_contamination = bool(re.search(rf"(?<!\d){page}(?!\d)", text[:40])) and page > 1

    # Duplicated text: the same 30-character run appearing twice.
    duplicated = False
    if len(text) > 120:
        window = text[20:50]
        duplicated = window.strip() != "" and text.count(window) > 1

    broken_products = []
    lowered = text.lower()
    for term in PRODUCT_TERMS:
        t = term.lower()
        if t in lowered and term not in text:
            # Present but not in its official casing.
            broken_products.append(term)

    return {
        "page": page,
        "chars": len(text),
        "words": len(words),
        "letters": letters,
        "stray_glyphs": len(stray),
        "fragment_ratio": round(frag_ratio, 3),
        "page_number_contamination": page_contamination,
        "duplicated_text": duplicated,
        "broken_product_casing": broken_products,
        "excessive_whitespace": len(REPEATED_WS.findall(text)),
        # Under ~120 characters a slide carries a title and little else; there
        # is not enough there to answer a question from.
        "thin": len(text) < 120,
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
                    Document.name,
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

    total = len(findings)
    thin = [f for f in findings if f["thin"]]
    fragmented = [f for f in findings if f["fragment_ratio"] > 0.25]
    stray_heavy = [f for f in findings if f["stray_glyphs"] > 8]
    duplicated = [f for f in findings if f["duplicated_text"]]
    contaminated = [f for f in findings if f["page_number_contamination"]]
    broken = [f for f in findings if f["broken_product_casing"]]

    print(f"  pages audited: {total}")
    print()
    print(f"  {'thin (<120 chars)':<34} {len(thin):>3}")
    print(f"  {'high fragment ratio (>0.25)':<34} {len(fragmented):>3}")
    print(f"  {'stray-glyph heavy (>8)':<34} {len(stray_heavy):>3}")
    print(f"  {'duplicated text':<34} {len(duplicated):>3}")
    print(f"  {'page-number contamination':<34} {len(contaminated):>3}")
    print(f"  {'broken product casing':<34} {len(broken):>3}")

    def show(label: str, items: list) -> None:
        if not items:
            return
        print(f"\n  {label}:")
        for f in items[:12]:
            print(
                f"    {f['product']}/p{f['page']:<3} chars={f['chars']:<5} "
                f"words={f['words']:<4} frag={f['fragment_ratio']:<5} "
                f"stray={f['stray_glyphs']}"
            )

    show("thin pages", thin)
    show("fragmented pages", fragmented)
    show("stray-glyph heavy pages", stray_heavy)

    # Does any of this reach a question the evaluation actually asks?
    corpus_path = Path("/app/tests/rag_eval/corpus.json")
    if corpus_path.exists():
        cases = json.loads(corpus_path.read_text(encoding="utf-8"))["cases"]
        suspect = {(f["product"], f["page"]) for f in thin + fragmented + stray_heavy}
        affected = []
        for case in cases:
            if not case.get("answerable"):
                continue
            product = case.get("expect_product")
            for page in case.get("expect_pages") or []:
                if (product, page) in suspect:
                    affected.append((case["id"], product, page))
        print(f"\n  evaluation cases whose expected page is flagged: {len(affected)}")
        for cid, product, page in affected[:15]:
            print(f"    {cid:<28} -> {product}/p{page}")
        if not affected:
            print("    none -- no flagged page is the expected answer for any case")

    Path("/tmp/ocr_audit.json").write_text(json.dumps(findings, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
