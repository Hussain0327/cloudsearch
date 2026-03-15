"""Abstract parser interface."""

from __future__ import annotations

import abc

from ingestion.models import ContentNode, CrawlResult


class BaseParser(abc.ABC):
    @abc.abstractmethod
    def parse(self, crawl_result: CrawlResult) -> ContentNode:
        """Parse a crawl result into a ContentNode tree.

        Returns a root SECTION node whose children represent the document structure.
        """
        ...
