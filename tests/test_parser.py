"""Tests for the AWS HTML parser."""

from __future__ import annotations

from datetime import datetime, timezone

from ingestion.models import ContentNodeType, CrawlResult
from ingestion.parser.aws import AWSParser
from ingestion.parser.content_tree import walk


def _make_crawl_result(html: str, url: str = "https://docs.aws.amazon.com/test/") -> CrawlResult:
    return CrawlResult(
        url=url,
        html=html,
        service_name="test",
        crawled_at=datetime.now(timezone.utc),
        content_hash="abc123",
    )


class TestAWSParser:
    def setup_method(self):
        self.parser = AWSParser()

    def test_parse_s3_bucket_policy(self, aws_s3_html):
        result = _make_crawl_result(aws_s3_html)
        tree = self.parser.parse(result)

        # Root should be a section with title
        assert tree.node_type == ContentNodeType.SECTION
        assert "Bucket policy examples" in tree.text

        # Should have children (sections for h2s)
        assert len(tree.children) > 0

        # Collect all node types
        all_nodes = walk(tree)
        node_types = {n.node_type for n in all_nodes}

        # Should have parsed code blocks, tables, paragraphs, admonitions
        assert ContentNodeType.CODE_BLOCK in node_types
        assert ContentNodeType.TABLE in node_types
        assert ContentNodeType.PARAGRAPH in node_types
        assert ContentNodeType.ADMONITION in node_types

    def test_parse_lambda_handler(self, aws_lambda_html):
        result = _make_crawl_result(aws_lambda_html)
        tree = self.parser.parse(result)

        assert "Lambda function handler in Python" in tree.text

        all_nodes = walk(tree)
        code_blocks = [n for n in all_nodes if n.node_type == ContentNodeType.CODE_BLOCK]

        # Should find both Python and JSON code blocks
        assert len(code_blocks) >= 2
        languages = {n.metadata.get("language", "") for n in code_blocks}
        assert "python" in languages
        assert "json" in languages

    def test_code_language_detection_json(self):
        html = """
        <div id="main-col-body">
            <h1>Test</h1>
            <pre><code>{"Effect": "Allow", "Principal": "*"}</code></pre>
        </div>
        """
        tree = self.parser.parse(_make_crawl_result(html))
        all_nodes = walk(tree)
        code_blocks = [n for n in all_nodes if n.node_type == ContentNodeType.CODE_BLOCK]
        assert len(code_blocks) == 1
        assert code_blocks[0].metadata["language"] == "json"

    def test_code_language_detection_bash(self):
        html = """
        <div id="main-col-body">
            <h1>Test</h1>
            <pre><code>$ aws s3 ls</code></pre>
        </div>
        """
        tree = self.parser.parse(_make_crawl_result(html))
        all_nodes = walk(tree)
        code_blocks = [n for n in all_nodes if n.node_type == ContentNodeType.CODE_BLOCK]
        assert len(code_blocks) == 1
        assert code_blocks[0].metadata["language"] == "bash"

    def test_table_to_markdown(self):
        html = """
        <div id="main-col-body">
            <h1>Test</h1>
            <table>
                <tr><th>Name</th><th>Value</th></tr>
                <tr><td>foo</td><td>bar</td></tr>
                <tr><td>baz</td><td>qux</td></tr>
            </table>
        </div>
        """
        tree = self.parser.parse(_make_crawl_result(html))
        all_nodes = walk(tree)
        tables = [n for n in all_nodes if n.node_type == ContentNodeType.TABLE]
        assert len(tables) == 1
        assert "| Name | Value |" in tables[0].text
        assert "| foo | bar |" in tables[0].text

    def test_strips_nav_and_footer(self):
        html = """
        <body>
        <nav>Should be removed</nav>
        <div id="main-col-body">
            <h1>Content</h1>
            <p>Real content here.</p>
        </div>
        <footer>Should be removed</footer>
        </body>
        """
        tree = self.parser.parse(_make_crawl_result(html))
        all_text = " ".join(n.text for n in walk(tree))
        assert "Should be removed" not in all_text
        assert "Real content" in all_text

    def test_heading_hierarchy(self):
        html = """
        <div id="main-col-body">
            <h1>Title</h1>
            <h2>Section A</h2>
            <p>Content A</p>
            <h3>Subsection A1</h3>
            <p>Content A1</p>
            <h2>Section B</h2>
            <p>Content B</p>
        </div>
        """
        tree = self.parser.parse(_make_crawl_result(html))

        # Root title comes from h1/title, h1 is skipped in tree building
        # h2 sections should be direct children of root
        h2_sections = [
            c for c in tree.children
            if c.node_type == ContentNodeType.SECTION and c.metadata.get("level") == 2
        ]
        assert len(h2_sections) == 2
        assert h2_sections[0].text == "Section A"
        assert h2_sections[1].text == "Section B"

        # Section A should have a subsection
        h3_sections = [
            c for c in h2_sections[0].children
            if c.node_type == ContentNodeType.SECTION and c.metadata.get("level") == 3
        ]
        assert len(h3_sections) == 1
        assert h3_sections[0].text == "Subsection A1"

    def test_admonition_parsing(self, aws_s3_html):
        tree = self.parser.parse(_make_crawl_result(aws_s3_html))
        all_nodes = walk(tree)
        admonitions = [n for n in all_nodes if n.node_type == ContentNodeType.ADMONITION]
        assert len(admonitions) >= 1
        assert any("anonymous" in a.text.lower() for a in admonitions)

    def test_list_parsing(self, aws_s3_html):
        tree = self.parser.parse(_make_crawl_result(aws_s3_html))
        all_nodes = walk(tree)
        lists = [n for n in all_nodes if n.node_type == ContentNodeType.LIST]
        assert len(lists) >= 1
