"""Tests for the BGE embedder."""

from __future__ import annotations

import numpy as np
import pytest

from ingestion.embedder.bge import BGEEmbedder
from ingestion.models import Chunk, ChunkType


@pytest.fixture(scope="module")
def embedder():
    """Shared embedder instance (model loading is expensive)."""
    return BGEEmbedder()


class TestBGEEmbedder:
    @pytest.mark.slow
    def test_embed_chunks(self, embedder):
        chunks = [
            Chunk(
                text="Amazon S3 bucket policies control access.",
                chunk_type=ChunkType.PROSE,
                section_path="S3 > Policies",
                token_count=8,
            ),
            Chunk(
                text="Lambda functions process events asynchronously.",
                chunk_type=ChunkType.PROSE,
                section_path="Lambda > Overview",
                token_count=7,
            ),
        ]

        result = embedder.embed_chunks(chunks, batch_size=2)

        assert len(result) == 2
        for chunk in result:
            assert chunk.embedding is not None
            assert chunk.embedding.shape == (1024,)
            assert chunk.embedding.dtype == np.float32
            # Should be L2-normalized
            norm = np.linalg.norm(chunk.embedding)
            assert abs(norm - 1.0) < 0.01

    @pytest.mark.slow
    def test_embed_query(self, embedder):
        embedding = embedder.embed_query("How do I set up an S3 bucket policy?")
        assert embedding.shape == (1024,)
        assert embedding.dtype == np.float32
        norm = np.linalg.norm(embedding)
        assert abs(norm - 1.0) < 0.01

    @pytest.mark.slow
    def test_similar_chunks_closer(self, embedder):
        """Semantically similar texts should have higher inner product."""
        chunks = [
            Chunk(text="S3 bucket policy for read access", chunk_type=ChunkType.PROSE,
                  section_path="", token_count=7),
            Chunk(text="S3 access control and permissions", chunk_type=ChunkType.PROSE,
                  section_path="", token_count=6),
            Chunk(text="Lambda function cold start optimization", chunk_type=ChunkType.PROSE,
                  section_path="", token_count=6),
        ]
        embedder.embed_chunks(chunks, batch_size=3)

        # S3 policy and S3 access should be more similar than S3 policy and Lambda
        sim_s3_s3 = np.dot(chunks[0].embedding, chunks[1].embedding)
        sim_s3_lambda = np.dot(chunks[0].embedding, chunks[2].embedding)
        assert sim_s3_s3 > sim_s3_lambda

    @pytest.mark.slow
    def test_empty_chunks(self, embedder):
        result = embedder.embed_chunks([])
        assert result == []

    @pytest.mark.slow
    def test_dimension(self, embedder):
        assert embedder.dimension == 1024
