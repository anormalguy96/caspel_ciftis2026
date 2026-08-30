"""Add a lexical search vector and GIN index to document_chunks.

Revision ID: 005_chunk_search_vector
Revises: 004_lead_message

Dense retrieval alone could not separate slides inside one deck: with a single
embedding per page, every slide in a presentation looks similar to any question
about that presentation, and observed cosine scores for a document's own pages
cluster inside roughly a 0.05 band. Exactly the tokens that would break the tie
-- product names, module names, LRIT, CRM, PO numbers -- are the ones a dense
average blurs away. This column gives those tokens somewhere to be matched.

The 'simple' configuration is deliberate and is not a placeholder for English:

  * The ERP deck is written in Azerbaijani. English stemming would mangle it.
  * Product names (CASPEL, IRISSEA, LRIT, CIFTIS) must match as written; an
    English stemmer is free to rewrite them.
  * 'simple' applies no stemming and no stop-word list, so a token matches when
    it is genuinely present.

Chinese is not tokenised usefully by any stock PostgreSQL configuration, so
lexical retrieval is not expected to contribute for Chinese queries. Dense
retrieval stays authoritative there; this column only ever adds candidates, and
grounding is still gated by the vector similarity threshold.

The column is STORED and generated, so it cannot drift from content, and no
application code has to remember to maintain it.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "005_chunk_search_vector"
down_revision: Union[str, None] = "004_lead_message"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE document_chunks
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED
        """
    )
    # GIN is the right index for a tsvector that is queried far more often than
    # it is written; this corpus is written once at ingestion.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_document_chunks_search_vector
        ON document_chunks USING GIN (search_vector)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_search_vector")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS search_vector")
