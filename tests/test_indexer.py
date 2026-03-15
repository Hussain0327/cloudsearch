"""Tests for the PostgreSQL indexer.

These tests require a running PostgreSQL instance with pgvector.
Run: docker compose up -d postgres && alembic upgrade head
"""

from __future__ import annotations

import numpy as np
import pytest

from ingestion.indexer.postgres import PostgresIndexer
from ingestion.models import Chunk, ChunkType


@pytest.fixture
async def indexer(db_dsn):
    idx = PostgresIndexer(dsn=db_dsn, pool_min=1, pool_max=2)
    await idx.connect()
    yield idx
    # Cleanup: remove test documents
    async with idx._pool.acquire() as conn:
        await conn.execute("DELETE FROM documents WHERE service_name = 'test'")
    await idx.close()


def _make_chunk(text: str, chunk_type: ChunkType = ChunkType.PROSE) -> Chunk:
    embedding = np.random.randn(1024).astype(np.float32)
    embedding = embedding / np.linalg.norm(embedding)  # Normalize
    return Chunk(
        text=text,
        chunk_type=chunk_type,
        section_path="Test > Section",
        token_count=10,
        embedding=embedding,
    )


@pytest.mark.db
class TestPostgresIndexer:
    @pytest.mark.asyncio
    async def test_index_document(self, indexer):
        chunks = [
            _make_chunk("Test chunk one"),
            _make_chunk("Test chunk two"),
        ]
        doc_id = await indexer.index_document(
            url="https://test.example.com/page1",
            service_name="test",
            title="Test Page",
            content_hash="abc123",
            chunks=chunks,
        )
        assert doc_id > 0

    @pytest.mark.asyncio
    async def test_upsert_replaces(self, indexer):
        url = "https://test.example.com/upsert-test"

        # First insert
        chunks_v1 = [_make_chunk("Version 1")]
        doc_id_v1 = await indexer.index_document(
            url=url, service_name="test", title="V1", content_hash="hash1", chunks=chunks_v1
        )

        # Second insert (same URL) should delete old and create new
        chunks_v2 = [_make_chunk("Version 2a"), _make_chunk("Version 2b")]
        doc_id_v2 = await indexer.index_document(
            url=url, service_name="test", title="V2", content_hash="hash2", chunks=chunks_v2
        )

        # New doc_id should be different
        assert doc_id_v2 != doc_id_v1

        # Should only have V2 chunks
        async with indexer._pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM chunks WHERE document_id = $1", doc_id_v2
            )
            assert count == 2

            # Old doc should be gone
            old_count = await conn.fetchval(
                "SELECT count(*) FROM documents WHERE id = $1", doc_id_v1
            )
            assert old_count == 0

    @pytest.mark.asyncio
    async def test_get_document_hash(self, indexer):
        url = "https://test.example.com/hash-test"
        chunks = [_make_chunk("Hash test")]
        await indexer.index_document(
            url=url, service_name="test", title="Hash", content_hash="myhash", chunks=chunks
        )

        result = await indexer.get_document_hash(url)
        assert result == "myhash"

        # Non-existent URL
        result = await indexer.get_document_hash("https://nonexistent.example.com/")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_stats(self, indexer):
        chunks = [_make_chunk("Stats test")]
        await indexer.index_document(
            url="https://test.example.com/stats-test",
            service_name="test",
            title="Stats",
            content_hash="stats",
            chunks=chunks,
        )

        stats = await indexer.get_stats()
        assert stats["documents"] >= 1
        assert stats["chunks"] >= 1
        assert "test" in stats["docs_per_service"]
        assert "test" in stats["chunks_per_service"]

    @pytest.mark.asyncio
    async def test_vector_search(self, indexer):
        """Verify vectors are queryable."""
        chunk = _make_chunk("S3 bucket policy example")
        await indexer.index_document(
            url="https://test.example.com/vector-test",
            service_name="test",
            title="Vector",
            content_hash="vec",
            chunks=[chunk],
        )

        # Query with the same vector (should match)
        async with indexer._pool.acquire() as conn:
            result = await conn.fetch(
                """
                SELECT text, (embedding <#> $1) as distance
                FROM chunks
                WHERE document_id IN (SELECT id FROM documents WHERE service_name = 'test')
                ORDER BY embedding <#> $1
                LIMIT 5
                """,
                chunk.embedding,
            )
            assert len(result) >= 1

    @pytest.mark.asyncio
    async def test_fulltext_search(self, indexer):
        """Verify tsvector search works."""
        chunk = _make_chunk("S3 bucket policy with IAM conditions")
        await indexer.index_document(
            url="https://test.example.com/fts-test",
            service_name="test",
            title="FTS",
            content_hash="fts",
            chunks=[chunk],
        )

        async with indexer._pool.acquire() as conn:
            result = await conn.fetch(
                """
                SELECT text
                FROM chunks
                WHERE search_vector @@ plainto_tsquery('english', $1)
                """,
                "bucket policy",
            )
            assert len(result) >= 1
            assert "bucket policy" in result[0]["text"].lower()
