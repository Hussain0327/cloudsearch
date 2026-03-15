"""Crawl state tracking via SQLite."""

from __future__ import annotations

from datetime import datetime

import aiosqlite


class CrawlState:
    """Tracks which URLs have been crawled and their content hashes."""

    def __init__(self, db_path: str = "crawl_state.db"):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS crawl_state (
                url TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                last_crawled_at TEXT NOT NULL
            )
        """)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    async def get_hash(self, url: str) -> str | None:
        """Get stored content hash for a URL."""
        async with self._db.execute(
            "SELECT content_hash FROM crawl_state WHERE url = ?", (url,)
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None

    async def update(self, url: str, content_hash: str) -> None:
        """Insert or update crawl state for a URL."""
        await self._db.execute(
            """
            INSERT INTO crawl_state (url, content_hash, last_crawled_at)
            VALUES (?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                content_hash = excluded.content_hash,
                last_crawled_at = excluded.last_crawled_at
            """,
            (url, content_hash, datetime.utcnow().isoformat()),
        )
        await self._db.commit()

    async def is_unchanged(self, url: str, content_hash: str) -> bool:
        """Check if URL content has changed since last crawl."""
        stored = await self.get_hash(url)
        return stored == content_hash
