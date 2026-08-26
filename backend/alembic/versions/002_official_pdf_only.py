"""Restrict the knowledge base to official PDF documents.

Revision ID: 002_official_pdf_only
Revises: 001_initial_schema
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002_official_pdf_only"
down_revision: Union[str, None] = "001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The removed development-only ingestion paths were the only writers of
    # non-PDF rows. Their chunks follow via the existing ON DELETE CASCADE.
    op.execute("DELETE FROM documents WHERE source_type <> 'pdf'")
    op.drop_column("documents", "source_type")


def downgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("source_type", sa.String(length=50), server_default="pdf", nullable=False),
    )
