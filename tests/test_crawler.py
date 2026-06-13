"""Tests for the AWS crawler scope derivation and link filtering.

These tests exercise pure URL/scope logic and require no network or DB.
"""

from __future__ import annotations

from datetime import datetime
from urllib.parse import urlparse

from ingestion.crawler.aws import AWSCrawler
from ingestion.crawler.state import CrawlState


def _derive_prefixes(crawler: AWSCrawler, seed_urls: list[str]) -> set[str]:
    """Mirror AWSCrawler.crawl()'s scope-prefix derivation for testing."""
    prefixes: set[str] = set()
    for url in seed_urls:
        parsed = urlparse(url)
        path = parsed.path
        last_segment = path.rsplit("/", 1)[1] if "/" in path else path
        if "." in last_segment:
            path = path.rsplit("/", 1)[0] + "/"
        prefix_url = f"{parsed.scheme}://{parsed.netloc}{path}"
        prefixes.add(crawler._normalize_url(prefix_url))
    return prefixes


class TestScopePrefixDerivation:
    def setup_method(self):
        self.crawler = AWSCrawler(state_db_path=":memory:")

    def test_filename_seed_yields_directory_prefix(self):
        seed = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        prefixes = _derive_prefixes(self.crawler, [seed])
        # Scope should be widened to the directory, not the filename.
        assert prefixes == {"https://docs.aws.amazon.com/lambda/latest/dg"}

    def test_sibling_page_in_scope_for_filename_seed(self):
        seed = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        prefixes = _derive_prefixes(self.crawler, [seed])

        sibling = self.crawler._normalize_url(
            "https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html"
        )
        assert any(sibling.startswith(p) for p in prefixes)

    def test_seed_page_remains_in_scope(self):
        seed = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        prefixes = _derive_prefixes(self.crawler, [seed])

        seed_norm = self.crawler._normalize_url(seed)
        assert any(seed_norm.startswith(p) for p in prefixes)

    def test_directory_seed_and_children_in_scope(self):
        seed = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/"
        prefixes = _derive_prefixes(self.crawler, [seed])

        # The normalized directory seed (trailing slash stripped) must match scope.
        seed_norm = self.crawler._normalize_url(seed)
        assert any(seed_norm.startswith(p) for p in prefixes)

        child = self.crawler._normalize_url(
            "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html"
        )
        assert any(child.startswith(p) for p in prefixes)


class TestExtractLinks:
    def setup_method(self):
        self.crawler = AWSCrawler(state_db_path=":memory:")

    def test_sibling_link_extracted_for_filename_seed(self):
        seed = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
        prefixes = _derive_prefixes(self.crawler, [seed])

        html = (
            '<html><body>'
            '<a href="getting-started.html">Getting started</a>'
            '<a href="https://example.com/out.html">Off-site</a>'
            '<a href="/lambda/latest/api-ref/index.html">API ref</a>'
            '</body></html>'
        )
        links = self.crawler._extract_links(html, seed, prefixes)

        assert "https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html" in links
        # Off-site and skip-pattern links must be excluded.
        assert all("example.com" not in link for link in links)
        assert all("api-ref" not in link for link in links)


class TestCrawlState:
    async def test_update_stores_tz_aware_timestamp(self, tmp_path):
        """CrawlState.update must store an offset-bearing (tz-aware) ISO timestamp."""
        state = CrawlState(str(tmp_path / "state.db"))
        await state.open()
        try:
            url = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
            await state.update(url, "hash123")
            async with state._db.execute(
                "SELECT last_crawled_at FROM crawl_state WHERE url = ?", (url,)
            ) as cursor:
                row = await cursor.fetchone()
            assert row is not None
            parsed = datetime.fromisoformat(row[0])
            # Must carry timezone info, matching CrawlResult.crawled_at.
            assert parsed.tzinfo is not None
        finally:
            await state.close()

    async def test_is_unchanged_roundtrip(self, tmp_path):
        state = CrawlState(str(tmp_path / "state.db"))
        await state.open()
        try:
            url = "https://docs.aws.amazon.com/s3/latest/userguide/x.html"
            assert await state.is_unchanged(url, "h1") is False
            await state.update(url, "h1")
            assert await state.is_unchanged(url, "h1") is True
            assert await state.is_unchanged(url, "h2") is False
        finally:
            await state.close()
