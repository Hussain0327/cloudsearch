"""Tests for the pipeline orchestrator.

Integration tests require Docker Postgres running.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ingestion.chunker.hierarchical import HierarchicalChunker
from ingestion.models import CrawlResult
from ingestion.parser.aws import AWSParser


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
