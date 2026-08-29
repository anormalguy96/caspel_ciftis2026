"""
Build the CASPEL AI knowledge base from the approved presentation decks.

Two things this script refuses to do, both learned the hard way:

1. It does not glob `*.pdf`. Ingesting whatever happens to be in the directory
   means an unrelated or superseded document can become a cited source that the
   assistant attributes to CASPEL. Only slugs with a registered SHA256 in
   app.core.presentations are considered, and each file is verified before a
   single byte of it is read.

2. It does not clear the corpus on request alone. `--clear` used to delete every
   document and chunk with no confirmation and no backup, which is a one-keystroke
   way to empty the knowledge base an hour before an exhibition opens. Clearing
   now requires an explicit confirmation flag and a database dump that this
   script has verified exists and is non-empty.
"""
import argparse
import asyncio
import logging
import sys
from pathlib import Path

from sqlalchemy import delete, func, select

# Add backend root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.presentations import PRESENTATIONS, REGISTERED_SLUGS, verify  # noqa: E402
from app.models.entities import Document, DocumentChunk  # noqa: E402
from app.rag.service import rag_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ingest_documents")

# A dump smaller than this is not a real backup of a populated database.
MIN_BACKUP_BYTES = 1024


def verify_backup(backup_path: str) -> Path:
    """Confirm a database dump exists and is plausibly a real one."""
    path = Path(backup_path).expanduser().resolve()
    if not path.is_file():
        raise SystemExit(f"Backup not found: {path}")
    size = path.stat().st_size
    if size < MIN_BACKUP_BYTES:
        raise SystemExit(f"Backup at {path} is only {size} bytes; refusing to treat it as a dump.")
    logger.info("Verified database backup: %s (%s bytes)", path, size)
    return path


async def clear_database_corpus() -> None:
    async with AsyncSessionLocal() as session:
        chunk_count = await session.scalar(select(func.count()).select_from(DocumentChunk)) or 0
        doc_count = await session.scalar(select(func.count()).select_from(Document)) or 0
        logger.warning("Deleting %s document(s) and %s chunk(s).", doc_count, chunk_count)
        await session.execute(delete(DocumentChunk))
        await session.execute(delete(Document))
        await session.commit()
    logger.info("Corpus cleared.")


async def report_corpus() -> int:
    """
    Print exactly what is in the knowledge base.

    Returns a process exit code: non-zero if anything about the corpus would
    stop /api/ready from reporting ready.
    """
    problems = 0
    async with AsyncSessionLocal() as session:
        docs = (await session.execute(select(Document).order_by(Document.id))).scalars().all()

        print("")
        print("=" * 72)
        print("KNOWLEDGE BASE CONTENTS")
        print("=" * 72)
        print(f"documents: {len(docs)}")

        approved_hashes = {
            PRESENTATIONS[slug].sha256: slug for slug in REGISTERED_SLUGS
        }
        seen_hashes = set()

        for doc in docs:
            chunk_count = await session.scalar(
                select(func.count())
                .select_from(DocumentChunk)
                .where(DocumentChunk.document_id == doc.id)
            ) or 0
            null_embeddings = await session.scalar(
                select(func.count())
                .select_from(DocumentChunk)
                .where(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.embedding.is_(None),
                )
            ) or 0
            pages_covered = await session.scalar(
                select(func.count(func.distinct(DocumentChunk.page_number)))
                .where(DocumentChunk.document_id == doc.id)
            ) or 0

            matched = approved_hashes.get(doc.source_sha256)
            if matched:
                seen_hashes.add(doc.source_sha256)

            print("")
            print(f"  [{doc.id}] {doc.name}")
            print(f"      product           : {doc.product}")
            print(f"      source sha256     : {doc.source_sha256 or '(not recorded)'}")
            print(f"      approved deck     : {matched or 'NO MATCH'}")
            print(f"      source pages      : {doc.source_page_count}")
            print(f"      pages with text   : {doc.pages_with_text}")
            print(f"      pages via OCR     : {doc.pages_via_ocr}")
            print(f"      pages w/o text    : {doc.pages_without_text}")
            print(f"      chunks            : {chunk_count}")
            print(f"      distinct pages    : {pages_covered}")
            print(f"      null embeddings   : {null_embeddings}")

            if not matched:
                print("      ** source hash does not match any approved deck")
                problems += 1
            if chunk_count == 0:
                print("      ** no chunks")
                problems += 1
            if null_embeddings:
                print("      ** chunks are missing embeddings")
                problems += 1

        missing = [
            slug for slug in REGISTERED_SLUGS
            if PRESENTATIONS[slug].sha256 not in seen_hashes
        ]
        print("")
        print(f"approved decks represented: {len(REGISTERED_SLUGS) - len(missing)}/{len(REGISTERED_SLUGS)}")
        for slug in missing:
            print(f"  ** missing: {slug}")
            problems += 1
        print("=" * 72)
        print("")

    return 1 if problems else 0


async def ingest_approved_decks() -> int:
    failures = 0
    async with AsyncSessionLocal() as session:
        if not REGISTERED_SLUGS:
            logger.error("No approved presentations are registered; nothing to ingest.")
            return 1

        for slug in REGISTERED_SLUGS:
            spec = PRESENTATIONS[slug]
            result = verify(slug)
            if not result.ok:
                logger.error(
                    "Refusing to ingest %s: integrity check failed (%s). Expected sha256 %s.",
                    slug, result.reason, spec.sha256,
                )
                failures += 1
                continue

            logger.info(
                "Ingesting %s from %s (%s bytes, %s pages, sha256 %s)",
                slug, result.path, result.size_bytes, result.page_count, result.sha256,
            )
            try:
                await rag_service.ingest_pdf(
                    db=session,
                    file_path=str(result.path),
                    document_name=spec.name,
                    product=spec.product,
                    source_sha256=result.sha256,
                )
            except Exception as e:
                logger.error("Failed to ingest %s: %s", slug, e)
                failures += 1

    if failures:
        logger.error("Ingestion failed for %s deck(s).", failures)
        return 1

    logger.info("Ingestion completed for %s approved deck(s).", len(REGISTERED_SLUGS))
    return 0


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest the approved CASPEL presentation PDFs into pgvector."
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Delete every document and chunk. Requires --confirm-clear-corpus and --backup.",
    )
    parser.add_argument(
        "--confirm-clear-corpus",
        action="store_true",
        help="Explicit confirmation that the corpus really should be deleted.",
    )
    parser.add_argument(
        "--backup",
        metavar="PATH",
        help="Path to a pg_dump taken before clearing. Verified before anything is deleted.",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Print corpus statistics and exit without changing anything.",
    )
    args = parser.parse_args()

    if args.report_only:
        return await report_corpus()

    if args.clear:
        if not args.confirm_clear_corpus:
            logger.error(
                "--clear deletes the entire knowledge base. Re-run with "
                "--confirm-clear-corpus and --backup <pg_dump path> if that is intended."
            )
            return 2
        if not args.backup:
            logger.error("--clear requires --backup <path to a verified pg_dump>.")
            return 2
        verify_backup(args.backup)
        await clear_database_corpus()
        return 0

    exit_code = await ingest_approved_decks()
    if exit_code == 0:
        exit_code = await report_corpus()
    return exit_code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
