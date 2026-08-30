"""Add message column to leads table for custom representative requests.

Revision ID: 004_lead_message
Revises: 003_document_source_integrity
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "004_lead_message"
down_revision: Union[str, None] = "003_document_source_integrity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("leads", sa.Column("message", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("leads", "message")
