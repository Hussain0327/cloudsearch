"""AWS documentation crawler using aiohttp + BFS."""

from __future__ import annotations

import asyncio
import hashlib
import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import aiohttp
import structlog

from ingestion.crawler.base import BaseCrawler
from ingestion.crawler.rate_limiter import TokenBucketRateLimiter
from ingestion.crawler.state import CrawlState
from ingestion.models import CrawlResult

log = structlog.get_logger()

# AWS service name extraction from URL
# e.g. https://docs.aws.amazon.com/AmazonS3/latest/userguide/ → "s3"
_SERVICE_NAME_RE = re.compile(
    r"docs\.aws\.amazon\.com/(?:Amazon)?(\w+)/", re.IGNORECASE
)

# Skip patterns — don't follow these links
_SKIP_PATTERNS = [
    r"/pricing/",
    r"/api[_-]?ref",
    r"/APIReference/",
    r"/release-?notes/",
    r"\.pdf$",
    r"\.zip$",
    r"#",  # Fragment-only links handled by normalization, but skip bare fragments
]
_SKIP_RE = re.compile("|".join(_SKIP_PATTERNS), re.IGNORECASE)


class AWSCrawler(BaseCrawler):
    def __init__(
        self,
        concurrency: int = 10,
        rate_limit_rps: float = 1.0,
        state_db_path: str = "crawl_state.db",
        request_timeout: int = 30,
    ):
        self._concurrency = concurrency
        self._rate_limiter = TokenBucketRateLimiter(rate=rate_limit_rps, burst=3)
        self._state = CrawlState(state_db_path)
        self._timeout = aiohttp.ClientTimeout(total=request_timeout)

    @property
    def state(self) -> CrawlState:
        """The crawl-state store. Persisted by the pipeline after a successful index."""
        return self._state

    async def crawl(self, seed_urls: list[str]) -> AsyncIterator[CrawlResult]:
        """BFS crawl from seed URLs, yielding pages as they're fetched."""
        await self._state.open()
        try:
            queue: asyncio.Queue[str] = asyncio.Queue()
            seen: set[str] = set()
            results: asyncio.Queue[CrawlResult | None] = asyncio.Queue()

            # Determine allowed path prefixes from seeds. Derive the scope from the
            # seed's DIRECTORY (drop a trailing filename) so a deep-page seed like
            # .../dg/welcome.html still expands to sibling pages under .../dg/.
            # Normalize the prefix the same way as queued URLs and discovered links
            # so trailing-slash handling matches and the seed itself stays in scope.
            prefixes = set()
            for url in seed_urls:
                parsed = urlparse(url)
                path = parsed.path
                last_segment = path.rsplit("/", 1)[1] if "/" in path else path
                if "." in last_segment:
                    # Looks like a file: widen scope to its directory.
                    path = path.rsplit("/", 1)[0] + "/"
                    log.info("seed_scope_widened_to_directory", seed=url, scope_path=path)
                prefix_url = f"{parsed.scheme}://{parsed.netloc}{path}"
                prefixes.add(self._normalize_url(prefix_url))

            for url in seed_urls:
                normalized = self._normalize_url(url)
                if normalized not in seen:
                    seen.add(normalized)
                    await queue.put(normalized)

            workers_done = asyncio.Event()
            active_workers = 0
            # Number of workers currently mid-fetch. The frontier is only truly
            # exhausted when the queue is empty AND no worker is fetching (whose
            # in-flight request may still enqueue new links).
            active_fetches = 0

            async def worker():
                nonlocal active_workers, active_fetches
                active_workers += 1
                try:
                    async with aiohttp.ClientSession(timeout=self._timeout) as session:
                        while True:
                            try:
                                url = queue.get_nowait()
                            except asyncio.QueueEmpty:
                                # No work AND nobody fetching => frontier exhausted.
                                if active_fetches == 0:
                                    break
                                await asyncio.sleep(0.05)
                                continue

                            active_fetches += 1
                            try:
                                result, links = await self._fetch_page(session, url, prefixes)
                                if result:
                                    # Forward whenever content changed; the crawl
                                    # state is persisted later, after a successful
                                    # Postgres index, to keep the two stores
                                    # consistent (see pipeline._embed_and_index_batch).
                                    if not await self._state.is_unchanged(
                                        url, result.content_hash
                                    ):
                                        await results.put(result)
                                    else:
                                        log.debug("page_unchanged", url=url)

                                # Enqueue new links
                                for link in links:
                                    normalized = self._normalize_url(link)
                                    if normalized not in seen:
                                        seen.add(normalized)
                                        await queue.put(normalized)

                            except Exception:
                                log.exception("crawl_error", url=url)
                            finally:
                                active_fetches -= 1
                                queue.task_done()
                finally:
                    active_workers -= 1
                    if active_workers == 0:
                        workers_done.set()
                        await results.put(None)  # Sentinel

            # Start workers
            worker_tasks = [
                asyncio.create_task(worker()) for _ in range(self._concurrency)
            ]

            # Yield results as they come in
            while True:
                result = await results.get()
                if result is None:
                    break
                yield result

            # Clean up
            for task in worker_tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*worker_tasks, return_exceptions=True)

            log.info("crawl_complete", pages_seen=len(seen))
        finally:
            await self._state.close()

    async def _fetch_page(
        self,
        session: aiohttp.ClientSession,
        url: str,
        prefixes: set[str],
    ) -> tuple[CrawlResult | None, list[str]]:
        """Fetch a single page. Returns (result, discovered_links)."""
        await self._rate_limiter.acquire()

        log.debug("fetching", url=url)
        async with session.get(url) as response:
            if response.status != 200:
                log.warning("fetch_failed", url=url, status=response.status)
                return None, []

            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type:
                return None, []

            html = await response.text()

        content_hash = hashlib.sha256(html.encode()).hexdigest()
        service_name = self._extract_service_name(url)

        result = CrawlResult(
            url=url,
            html=html,
            service_name=service_name,
            crawled_at=datetime.now(timezone.utc),
            content_hash=content_hash,
        )

        # Extract links
        links = self._extract_links(html, url, prefixes)

        return result, links

    def _extract_links(self, html: str, base_url: str, prefixes: set[str]) -> list[str]:
        """Extract and filter links from HTML."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        links = []

        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("#") or href.startswith("javascript:"):
                continue

            absolute = urljoin(base_url, href)
            normalized = self._normalize_url(absolute)

            # Check scope
            if not any(normalized.startswith(p) for p in prefixes):
                continue

            if _SKIP_RE.search(normalized):
                continue

            links.append(normalized)

        return links

    @staticmethod
    def _normalize_url(url: str) -> str:
        """Normalize URL: remove fragment, trailing slash."""
        parsed = urlparse(url)
        # Remove fragment
        normalized = parsed._replace(fragment="").geturl()
        # Remove trailing slash for consistency (except root paths)
        if normalized.endswith("/") and normalized.count("/") > 3:
            normalized = normalized.rstrip("/")
        return normalized

    @staticmethod
    def _extract_service_name(url: str) -> str:
        """Extract AWS service name from URL."""
        match = _SERVICE_NAME_RE.search(url)
        if match:
            name = match.group(1).lower()
            # Normalize common names
            name_map = {
                "amazons3": "s3",
                "s3": "s3",
                "amazonec2": "ec2",
                "ec2": "ec2",
                "lambda": "lambda",
                "awslambda": "lambda",
                "dynamodb": "dynamodb",
                "amazondynamodb": "dynamodb",
                "amazonrds": "rds",
                "rds": "rds",
                "amazonvpc": "vpc",
                "vpc": "vpc",
                "amazoneks": "eks",
                "eks": "eks",
                "amazonecs": "ecs",
                "ecs": "ecs",
                "amazoniam": "iam",
                "iam": "iam",
                "amazonsqs": "sqs",
                "sqs": "sqs",
                "amazonsns": "sns",
                "sns": "sns",
                "amazoncloudwatch": "cloudwatch",
                "cloudwatch": "cloudwatch",
            }
            return name_map.get(name, name)
        return "unknown"
