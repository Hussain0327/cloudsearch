"""EDGAR filings, extracted facts, and cross-filing links.

Revision ID: 002
Revises: 001
Create Date: 2026-10-16

These tables back the "spider" viewer: a filing's annotated HTML (every
extracted fact wrapped in a <span data-fact-id=...>), the structured facts in
document order, and links from a fact (a company mention) to another filing in
the universe so the spider can hop between documents.

The tables are intentionally independent of the documents/chunks tables and of
pgvector, so they can be created and tested on a plain Postgres.
"""

from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE filings (
            id               BIGSERIAL PRIMARY KEY,
            cik              TEXT NOT NULL,
            ticker           TEXT NOT NULL,
            company_name     TEXT NOT NULL,
            form_type        TEXT NOT NULL,
            accession_number TEXT NOT NULL UNIQUE,
            filed_at         DATE,
            period_of_report DATE,
            fiscal_year      INTEGER,
            source_url       TEXT NOT NULL,
            content_hash     VARCHAR(64) NOT NULL,
            raw_html         TEXT NOT NULL,
            annotated_html   TEXT NOT NULL,
            fact_count       INTEGER NOT NULL DEFAULT 0,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_filings_ticker ON filings (ticker)")
    op.execute("CREATE INDEX ix_filings_cik ON filings (cik)")

    op.execute(
        """
        CREATE TABLE facts (
            id            BIGSERIAL PRIMARY KEY,
            filing_id     BIGINT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
            fact_index    INTEGER NOT NULL,
            dom_id        TEXT NOT NULL,
            category      TEXT NOT NULL
                          CHECK (category IN ('revenue', 'debt', 'shares', 'other')),
            kind          TEXT NOT NULL
                          CHECK (kind IN ('money', 'percent', 'shares', 'date', 'entity', 'text')),
            raw_text      TEXT NOT NULL,
            label         TEXT NOT NULL,
            value_numeric NUMERIC,
            unit          TEXT,
            context       TEXT NOT NULL DEFAULT '',
            section       TEXT NOT NULL DEFAULT '',
            concept       TEXT,
            source        TEXT NOT NULL DEFAULT 'regex'
                          CHECK (source IN ('ixbrl', 'regex', 'entity')),
            UNIQUE (filing_id, fact_index),
            UNIQUE (filing_id, dom_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_facts_filing_category ON facts (filing_id, category)")

    op.execute(
        """
        CREATE TABLE filing_links (
            id               BIGSERIAL PRIMARY KEY,
            filing_id        BIGINT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
            fact_index       INTEGER NOT NULL,
            dom_id           TEXT NOT NULL,
            target_ticker    TEXT NOT NULL,
            target_filing_id BIGINT REFERENCES filings(id) ON DELETE SET NULL,
            mention_text     TEXT NOT NULL,
            UNIQUE (filing_id, dom_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_filing_links_filing ON filing_links (filing_id)")
    op.execute("CREATE INDEX ix_filing_links_target ON filing_links (target_ticker)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS filing_links")
    op.execute("DROP TABLE IF EXISTS facts")
    op.execute("DROP TABLE IF EXISTS filings")
