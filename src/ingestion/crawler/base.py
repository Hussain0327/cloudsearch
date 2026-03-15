"""Abstract crawler interface."""

from __future__ import annotations

import abc
from collections.abc import AsyncIterator

from ingestion.models import CrawlResult


class BaseCrawler(abc.ABC):
    @abc.abstractmethod
    async def crawl(self, seed_urls: list[str]) -> AsyncIterator[CrawlResult]:
        """Crawl starting from seed URLs, yielding CrawlResult for each page."""
        ...
        yield  # Make this a generator for type checking  # pragma: no cover
