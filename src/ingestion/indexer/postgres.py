"""PostgreSQL indexer using asyncpg with pgvector support."""

from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import structlog

from ingestion.models import Chunk

log = structlog.get_logger()


class PostgresIndexer:
    def __init__(self, dsn: str, pool_min: int = 2, pool_max: int = 10):
        self._dsn = dsn
        self._pool_min = pool_min
        self._pool_max = pool_max
        self._pool = None

    async def connect(self) -> None:
        import asyncpg
        from pgvector.asyncpg import register_vector

        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=self._pool_min,
            max_size=self._pool_max,
            init=register_vector,
        )
        log.info("postgres_connected", dsn=self._dsn.split("@")[-1])  # Log host only

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
            log.info("postgres_disconnected")

    async def index_document(
        self,
        url: str,
        service_name: str,
        title: str,
        content_hash: str,
        chunks: list[Chunk],
        crawled_at: datetime | None = None,
    ) -> int:
        """Index a document and its chunks. Delete-cascade upsert.

        Returns the document ID.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # Delete existing document (cascades to chunks)
                await conn.execute("DELETE FROM documents WHERE url = $1", url)

                # Insert new document
                doc_id = await conn.fetchval(
                    """
                    INSERT INTO documents (url, service_name, title, content_hash, crawled_at)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                    """,
                    url,
                    service_name,
                    title,
                    content_hash,
                    crawled_at,
                )

                # Batch insert chunks
                if chunks:
                    chunk_records = [
                        (
                            doc_id,
                            chunk.text,
                            chunk.chunk_type.value,
                            chunk.section_path,
                            chunk.token_count,
                            json.dumps(chunk.metadata),
                            i,
                            np.array(chunk.embedding, dtype=np.float32) if chunk.embedding is not None else None,
                        )
                        for i, chunk in enumerate(chunks)
                    ]

                    await conn.executemany(
                        """
                        INSERT INTO chunks
                            (document_id, text, chunk_type, section_path, token_count,
                             metadata, chunk_index, embedding)
                        VALUES ($1, $2, $3::chunk_type, $4, $5, $6::jsonb, $7, $8)
                        """,
                        chunk_records,
                    )

                log.info(
                    "document_indexed",
                    url=url,
                    doc_id=doc_id,
                    chunks=len(chunks),
                )
                return doc_id

    async def get_document_hash(self, url: str) -> str | None:
        """Get the content hash for a URL, or None if not indexed."""
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT content_hash FROM documents WHERE url = $1", url
            )

    async def get_stats(self) -> dict:
        """Get index statistics."""
        async with self._pool.acquire() as conn:
            doc_count = await conn.fetchval("SELECT count(*) FROM documents")
            chunk_count = await conn.fetchval("SELECT count(*) FROM chunks")
            service_rows = await conn.fetch(
                """
                SELECT d.service_name,
                       COUNT(DISTINCT d.id) AS doc_cnt,
                       COUNT(c.id) AS chunk_cnt
                FROM documents d
                LEFT JOIN chunks c ON c.document_id = d.id
                GROUP BY d.service_name
                ORDER BY d.service_name
                """
            )
            return {
                "documents": doc_count,
                "chunks": chunk_count,
                "docs_per_service": {r["service_name"]: r["doc_cnt"] for r in service_rows},
                "chunks_per_service": {r["service_name"]: r["chunk_cnt"] for r in service_rows},
            }
