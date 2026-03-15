"""Initial schema: documents + chunks with pgvector and tsvector.

Revision ID: 001
Revises:
Create Date: 2026-03-15
"""

from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Create chunk_type enum
    op.execute("CREATE TYPE chunk_type AS ENUM ('prose', 'code', 'table', 'config')")

    # Documents table
    op.create_table(
        "documents",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("url", sa.Text, nullable=False, unique=True),
        sa.Column("service_name", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False, server_default=""),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("crawled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("ix_documents_service_name", "documents", ["service_name"])

    # Chunks table (using raw SQL for chunk_type to avoid sa.Enum double-creation)
    op.execute("""
        CREATE TABLE chunks (
            id BIGSERIAL PRIMARY KEY,
            document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            chunk_type chunk_type NOT NULL,
            section_path TEXT NOT NULL DEFAULT '',
            token_count INTEGER NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}',
            chunk_index INTEGER NOT NULL DEFAULT 0,
            embedding vector(1024),
            search_vector tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(section_path, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(text, '')), 'B')
            ) STORED
        )
    """)

    # HNSW index for vector similarity (inner product on normalized vectors)
    op.execute("""
        CREATE INDEX ix_chunks_embedding_hnsw
        ON chunks USING hnsw (embedding vector_ip_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    # GIN index for full-text search
    op.execute("""
        CREATE INDEX ix_chunks_search_vector
        ON chunks USING gin (search_vector)
    """)

    # Index on document_id for cascade deletes
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"])


def downgrade() -> None:
    op.drop_table("chunks")
    op.drop_table("documents")
    op.execute("DROP TYPE IF EXISTS chunk_type")
    op.execute("DROP EXTENSION IF EXISTS vector")
