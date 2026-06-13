"""Tests for the pipeline orchestrator.

Integration tests require Docker Postgres running.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ingestion.chunker.hierarchical import HierarchicalChunker
from ingestion.models import Chunk, ChunkType, CrawlResult
from ingestion.parser.aws import AWSParser
from ingestion.pipeline import IngestPipeline


class TestParseAndChunkIntegration:
    """Test the parse → chunk pipeline without needing Postgres or embedder."""

    def setup_method(self):
        self.parser = AWSParser()
        self.chunker = HierarchicalChunker(max_tokens=512, overlap_tokens=50)

    def test_s3_end_to_end(self, aws_s3_html):
        result = CrawlResult(
            url="https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html",
            html=aws_s3_html,
            service_name="s3",
            crawled_at=datetime.now(timezone.utc),
            content_hash="abc",
        )

        tree = self.parser.parse(result)
        chunks = self.chunker.chunk(tree)

        assert len(chunks) > 0

        # All chunks should have section paths
        for chunk in chunks:
            assert chunk.section_path, f"Chunk missing section_path: {chunk.text[:50]}"

        # All chunks should have token counts
        for chunk in chunks:
            assert chunk.token_count > 0

    def test_lambda_end_to_end(self, aws_lambda_html):
        result = CrawlResult(
            url="https://docs.aws.amazon.com/lambda/latest/dg/handler.html",
            html=aws_lambda_html,
            service_name="lambda",
            crawled_at=datetime.now(timezone.utc),
            content_hash="abc",
        )

        tree = self.parser.parse(result)
        chunks = self.chunker.chunk(tree)

        assert len(chunks) > 0

        # Check we have a mix of chunk types
        chunk_types = {c.chunk_type.value for c in chunks}
        assert "prose" in chunk_types
        # Lambda fixture has Python code and JSON
        code_or_config = [c for c in chunks if c.chunk_type.value in ("code", "config")]
        assert len(code_or_config) >= 2


class _FakeState:
    """Records crawl-state updates without touching SQLite."""

    def __init__(self):
        self.updated: list[tuple[str, str]] = []

    async def update(self, url: str, content_hash: str) -> None:
        self.updated.append((url, content_hash))


class TestCrawlStateDecoupling:
    """Crawl state must be persisted only AFTER a successful Postgres index."""

    def _make_pipeline(self) -> IngestPipeline:
        # Constructed lazily; embedder/indexer are stubbed per-test so no real
        # model or DB connection is required.
        pipeline = IngestPipeline()
        # embed_chunks is called via run_in_executor (sync callable); keep it sync.
        pipeline._embedder.embed_chunks = lambda chunks, batch_size: None
        return pipeline

    def _chunk(self) -> Chunk:
        return Chunk(text="[Sec] body", chunk_type=ChunkType.PROSE, section_path="Sec", token_count=2)

    async def test_state_updated_after_successful_index(self):
        pipeline = self._make_pipeline()
        indexed: list[str] = []

        async def _get_hash(url):
            return None  # nothing indexed yet

        async def _index_document(**kwargs):
            indexed.append(kwargs["url"])
            return 1

        pipeline._indexer.get_document_hash = _get_hash
        pipeline._indexer.index_document = _index_document

        state = _FakeState()
        url = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        chunks = [self._chunk()]
        meta = [(url, "lambda", "Welcome", "hash1", datetime.now(timezone.utc))]

        await pipeline._embed_and_index_batch(chunks, meta, state=state)

        assert indexed == [url]
        assert state.updated == [(url, "hash1")]

    async def test_state_not_updated_when_index_raises(self):
        pipeline = self._make_pipeline()

        async def _get_hash(url):
            return None

        async def _index_document(**kwargs):
            raise RuntimeError("postgres down")

        pipeline._indexer.get_document_hash = _get_hash
        pipeline._indexer.index_document = _index_document

        state = _FakeState()
        url = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        meta = [(url, "lambda", "Welcome", "hash1", datetime.now(timezone.utc))]

        with pytest.raises(RuntimeError):
            await pipeline._embed_and_index_batch([self._chunk()], meta, state=state)

        # State must NOT record the URL since Postgres never received the document.
        assert state.updated == []

    async def test_state_self_heals_on_unchanged_branch(self):
        pipeline = self._make_pipeline()

        async def _get_hash(url):
            return "hash1"  # Postgres already has this exact document

        async def _index_document(**kwargs):  # pragma: no cover - must not be called
            raise AssertionError("index_document should not run for unchanged docs")

        pipeline._indexer.get_document_hash = _get_hash
        pipeline._indexer.index_document = _index_document

        state = _FakeState()
        url = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        meta = [(url, "lambda", "Welcome", "hash1", datetime.now(timezone.utc))]

        await pipeline._embed_and_index_batch([self._chunk()], meta, state=state)

        # Self-heal: state is recorded because Postgres already has the row.
        assert state.updated == [(url, "hash1")]
