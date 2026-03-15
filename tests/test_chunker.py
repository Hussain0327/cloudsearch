"""Tests for the hierarchical chunker."""

from __future__ import annotations

from datetime import datetime, timezone

from ingestion.chunker.hierarchical import HierarchicalChunker
from ingestion.chunker.strategies import CodeChunkStrategy, ProseChunkStrategy, TableChunkStrategy
from ingestion.chunker.token_counter import count_tokens
from ingestion.models import ChunkType, ContentNode, ContentNodeType, CrawlResult
from ingestion.parser.aws import AWSParser


class TestTokenCounter:
    def test_count_tokens_basic(self):
        tokens = count_tokens("Hello, world!")
        assert tokens > 0
        assert tokens < 10

    def test_count_tokens_empty(self):
        assert count_tokens("") == 0


class TestProseChunkStrategy:
    def setup_method(self):
        self.strategy = ProseChunkStrategy(max_tokens=50)

    def test_short_text_single_chunk(self):
        chunks = self.strategy.chunk("This is short.", "Section A")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.PROSE
        assert "[Section A]" in chunks[0].text

    def test_long_text_splits(self):
        # Generate text that exceeds max_tokens
        long_text = " ".join(["This is a sentence about AWS services."] * 50)
        chunks = self.strategy.chunk(long_text, "S3 > Overview")
        assert len(chunks) > 1
        for chunk in chunks:
            assert "[S3 > Overview]" in chunk.text

    def test_empty_section_path(self):
        chunks = self.strategy.chunk("Some text.", "")
        assert len(chunks) == 1
        assert not chunks[0].text.startswith("[")


class TestCodeChunkStrategy:
    def setup_method(self):
        self.strategy = CodeChunkStrategy()

    def test_code_block_atomic(self):
        """Code blocks must never be split, even if large."""
        large_code = "x = 1\n" * 500  # Way over any token limit
        chunks = self.strategy.chunk(large_code, "Lambda > Handler", "python")
        assert len(chunks) == 1  # ATOMIC — never split
        assert "```python" in chunks[0].text
        assert chunks[0].chunk_type == ChunkType.CODE

    def test_config_detection_iam(self):
        iam_policy = '{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject"}'
        chunks = self.strategy.chunk(iam_policy, "S3 > Policy", "json")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.CONFIG

    def test_config_detection_cloudformation(self):
        cfn = '"AWSTemplateFormatVersion": "2010-09-09"'
        chunks = self.strategy.chunk(cfn, "CloudFormation", "json")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.CONFIG

    def test_config_detection_terraform(self):
        tf = 'resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n}'
        chunks = self.strategy.chunk(tf, "Terraform", "hcl")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.CONFIG

    def test_regular_code_not_config(self):
        code = "def handler(event, context):\n    return {'statusCode': 200}"
        chunks = self.strategy.chunk(code, "Lambda", "python")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.CODE

    def test_markdown_fences(self):
        chunks = self.strategy.chunk("echo hello", "Test", "bash")
        assert "```bash" in chunks[0].text
        assert "```" in chunks[0].text


class TestTableChunkStrategy:
    def setup_method(self):
        self.strategy = TableChunkStrategy(max_tokens=50)

    def test_small_table_single_chunk(self):
        table = "| A | B |\n| --- | --- |\n| 1 | 2 |"
        chunks = self.strategy.chunk(table, "Table Section")
        assert len(chunks) == 1
        assert chunks[0].chunk_type == ChunkType.TABLE

    def test_large_table_splits_with_headers(self):
        rows = ["| Name | Value |", "| --- | --- |"]
        for i in range(100):
            rows.append(f"| item_{i} | value_{i} |")
        table = "\n".join(rows)

        chunks = self.strategy.chunk(table, "Large Table")
        assert len(chunks) > 1

        # Every chunk should contain the header
        for chunk in chunks:
            assert "| Name | Value |" in chunk.text
            assert "| --- | --- |" in chunk.text


class TestHierarchicalChunker:
    def setup_method(self):
        self.chunker = HierarchicalChunker(max_tokens=100, overlap_tokens=20)

    def test_section_path_tracking(self):
        root = ContentNode(
            node_type=ContentNodeType.SECTION,
            text="S3",
            metadata={"level": 0},
            children=[
                ContentNode(
                    node_type=ContentNodeType.SECTION,
                    text="Bucket Policies",
                    metadata={"level": 1},
                    children=[
                        ContentNode(
                            node_type=ContentNodeType.PARAGRAPH,
                            text="Bucket policies control access to S3 buckets.",
                        ),
                    ],
                ),
            ],
        )
        chunks = self.chunker.chunk(root)
        assert len(chunks) >= 1
        assert "S3" in chunks[0].section_path
        assert "Bucket Policies" in chunks[0].section_path

    def test_code_blocks_remain_atomic(self, aws_s3_html):
        parser = AWSParser()
        result = CrawlResult(
            url="https://docs.aws.amazon.com/test/",
            html=aws_s3_html,
            service_name="s3",
            crawled_at=datetime.now(timezone.utc),
            content_hash="abc",
        )
        tree = parser.parse(result)
        chunks = self.chunker.chunk(tree)

        code_chunks = [c for c in chunks if c.chunk_type in (ChunkType.CODE, ChunkType.CONFIG)]
        assert len(code_chunks) >= 2  # At least the IAM policies + CLI commands

        # Each code chunk should contain fenced code
        for chunk in code_chunks:
            assert "```" in chunk.text

    def test_section_path_across_heading_levels(self):
        root = ContentNode(
            node_type=ContentNodeType.SECTION,
            text="Root",
            metadata={"level": 0},
            children=[
                ContentNode(
                    node_type=ContentNodeType.SECTION,
                    text="Level 1",
                    metadata={"level": 1},
                    children=[
                        ContentNode(
                            node_type=ContentNodeType.SECTION,
                            text="Level 2",
                            metadata={"level": 2},
                            children=[
                                ContentNode(
                                    node_type=ContentNodeType.PARAGRAPH,
                                    text="Deep content.",
                                ),
                            ],
                        ),
                    ],
                ),
            ],
        )
        chunks = self.chunker.chunk(root)
        assert len(chunks) >= 1
        # Path should contain all levels
        assert "Root" in chunks[0].section_path
        assert "Level 1" in chunks[0].section_path
        assert "Level 2" in chunks[0].section_path

    def test_admonition_chunking(self):
        root = ContentNode(
            node_type=ContentNodeType.SECTION,
            text="Warnings",
            metadata={"level": 0},
            children=[
                ContentNode(
                    node_type=ContentNodeType.ADMONITION,
                    text="Be careful with permissions.",
                    metadata={"title": "Warning"},
                ),
            ],
        )
        chunks = self.chunker.chunk(root)
        assert len(chunks) == 1
        assert "Warning" in chunks[0].text
        assert "permissions" in chunks[0].text

    def test_full_parse_and_chunk_s3(self, aws_s3_html):
        parser = AWSParser()
        result = CrawlResult(
            url="https://docs.aws.amazon.com/test/",
            html=aws_s3_html,
            service_name="s3",
            crawled_at=datetime.now(timezone.utc),
            content_hash="abc",
        )
        tree = parser.parse(result)
        chunks = self.chunker.chunk(tree)

        # Should produce multiple chunks
        assert len(chunks) >= 5

        # Check chunk types present
        types = {c.chunk_type for c in chunks}
        assert ChunkType.PROSE in types
        assert ChunkType.TABLE in types
        # IAM policies should be detected as CONFIG
        config_chunks = [c for c in chunks if c.chunk_type == ChunkType.CONFIG]
        assert len(config_chunks) >= 1

    def test_full_parse_and_chunk_lambda(self, aws_lambda_html):
        parser = AWSParser()
        result = CrawlResult(
            url="https://docs.aws.amazon.com/test/",
            html=aws_lambda_html,
            service_name="lambda",
            crawled_at=datetime.now(timezone.utc),
            content_hash="abc",
        )
        tree = parser.parse(result)
        chunks = self.chunker.chunk(tree)

        assert len(chunks) >= 4

        # Should have code chunks for Python and JSON examples
        code_chunks = [c for c in chunks if c.chunk_type in (ChunkType.CODE, ChunkType.CONFIG)]
        assert len(code_chunks) >= 2
