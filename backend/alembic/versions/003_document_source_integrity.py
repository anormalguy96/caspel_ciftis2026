"""Track the exact source file each document was ingested from.

Revision ID: 003_document_source_integrity
Revises: 002_official_pdf_only

Readiness has to be able to answer "was this knowledge base built from the
approved decks?". Before this, a `documents` row recorded only a path — which
says nothing about the bytes that were read, and stays identical if the file at
that path is replaced. The SHA256 is stored so /api/ready can compare it against
the approved digests, and the coverage counters are stored so a deck where most
slides failed to extract is visibly different from one that indexed cleanly.

Existing rows get NULL and therefore do not satisfy readiness until they are
re-ingested. That is the intended behaviour: a corpus whose provenance is
unknown must not be certified as the approved one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_document_source_integrity"
down_revision: Union[str, None] = "002_official_pdf_only"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("source_sha256", sa.String(length=64), nullable=True))
    op.add_column("documents", sa.Column("source_page_count", sa.Integer(), nullable=True))
    op.add_column("documents", sa.Column("pages_with_text", sa.Integer(), nullable=True))
    op.add_column("documents", sa.Column("pages_via_ocr", sa.Integer(), nullable=True))
    op.add_column("documents", sa.Column("pages_without_text", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_documents_source_sha256"), "documents", ["source_sha256"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_documents_source_sha256"), table_name="documents")
    op.drop_column("documents", "pages_without_text")
    op.drop_column("documents", "pages_via_ocr")
    op.drop_column("documents", "pages_with_text")
    op.drop_column("documents", "source_page_count")
    op.drop_column("documents", "source_sha256")
