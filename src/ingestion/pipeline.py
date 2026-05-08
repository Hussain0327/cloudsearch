"""Async pipeline orchestrator: crawl → parse → chunk → embed → index."""

from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import structlog

from ingestion.chunker.hierarchical import HierarchicalChunker
from ingestion.config import PipelineSettings
from ingestion.crawler.aws import AWSCrawler
from ingestion.embedder.bge import BGEEmbedder
from ingestion.indexer.postgres import PostgresIndexer
from ingestion.models import Chunk, CrawlResult
from ingestion.parser.aws import AWSParser

log = structlog.get_logger()

# AWS service name → seed URL mapping
SERVICE_SEED_URLS: dict[str, str] = {
    "s3": "https://docs.aws.amazon.com/AmazonS3/latest/userguide/",
    "ec2": "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/",
    "lambda": "https://docs.aws.amazon.com/lambda/latest/dg/",
    "dynamodb": "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/",
    "rds": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/",
    "vpc": "https://docs.aws.amazon.com/vpc/latest/userguide/",
    "eks": "https://docs.aws.amazon.com/eks/latest/userguide/",
    "ecs": "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/",
    "iam": "https://docs.aws.amazon.com/IAM/latest/UserGuide/",
    "sqs": "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/",
    "sns": "https://docs.aws.amazon.com/sns/latest/dg/",
    "cloudwatch": "https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/",
    "cloudformation": "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/",
    "route53": "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/",
    "elasticache": "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/",
}


class IngestPipeline:
    def __init__(self, settings: PipelineSettings | None = None):
        self.settings = settings or PipelineSettings()
        self._parser = AWSParser()
        self._chunker = HierarchicalChunker(
            max_tokens=self.settings.chunker.max_tokens,
            overlap_tokens=self.settings.chunker.overlap_tokens,
        )
        self._embedder = BGEEmbedder(
            model_name=self.settings.embedder.model_name,
            device=self.settings.embedder.device,
        )
        self._indexer = PostgresIndexer(
            dsn=self.settings.database.dsn,
            pool_min=self.settings.database.pool_min,
            pool_max=self.settings.database.pool_max,
        )
        self._executor = ThreadPoolExecutor(max_workers=2)

    async def run(
        self,
        services: list[str] | None = None,
        extra_urls: list[str] | None = None,
        max_pages: int | None = None,
    ) -> dict:
        """Run the full pipeline for given services (or all)."""
        start = time.monotonic()
        seed_urls = self._resolve_seeds(services)
        if extra_urls:
            # Preserve order and dedupe while merging
            seen = set(seed_urls)
            for u in extra_urls:
                if u not in seen:
                    seed_urls.append(u)
                    seen.add(u)

        log.info("pipeline_start", services=services or "all", seeds=len(seed_urls), max_pages=max_pages)

        await self._indexer.connect()
        try:
            stats = await self._process(seed_urls, max_pages=max_pages)
        finally:
            await self._indexer.close()

        elapsed = time.monotonic() - start
        stats["elapsed_seconds"] = round(elapsed, 2)
        log.info("pipeline_complete", **stats)
        return stats

    async def _process(self, seed_urls: list[str], max_pages: int | None = None) -> dict:
        crawler = AWSCrawler(
            concurrency=self.settings.crawler.concurrency,
            rate_limit_rps=self.settings.crawler.rate_limit_rps,
            state_db_path=self.settings.crawler.state_db_path,
            request_timeout=self.settings.crawler.request_timeout,
        )

        pages_crawled = 0
        pages_skipped = 0
        pages_errored = 0
        total_chunks = 0
        pending_chunks: list[Chunk] = []
        pending_meta: list[tuple[str, str, str, str, datetime]] = []  # url, service, title, hash, crawled_at

        crawl_iter = crawler.crawl(seed_urls)
        try:
            async for crawl_result in crawl_iter:
                try:
                    chunks, title = self._parse_and_chunk(crawl_result)
                    if not chunks:
                        pages_skipped += 1
                        continue

                    pages_crawled += 1
                    total_chunks += len(chunks)

                    pending_chunks.extend(chunks)
                    for _ in chunks:
                        pending_meta.append((
                            crawl_result.url,
                            crawl_result.service_name,
                            title,
                            crawl_result.content_hash,
                            crawl_result.crawled_at,
                        ))

                    # Embed in batches
                    if len(pending_chunks) >= self.settings.embed_batch_size:
                        await self._embed_and_index_batch(pending_chunks, pending_meta)
                        pending_chunks = []
                        pending_meta = []

                except Exception:
                    pages_errored += 1
                    log.exception("page_processing_error", url=crawl_result.url)

                if max_pages is not None and (pages_crawled + pages_skipped) >= max_pages:
                    log.info("max_pages_reached", limit=max_pages)
                    break
        finally:
            await crawl_iter.aclose()

        # Flush remaining
        if pending_chunks:
            await self._embed_and_index_batch(pending_chunks, pending_meta)

        return {
            "pages_crawled": pages_crawled,
            "pages_skipped": pages_skipped,
            "pages_errored": pages_errored,
            "total_chunks": total_chunks,
        }

    def _parse_and_chunk(self, crawl_result: CrawlResult) -> tuple[list[Chunk], str]:
        """Parse HTML and chunk. Runs synchronously."""
        tree = self._parser.parse(crawl_result)
        title = tree.text or ""
        chunks = self._chunker.chunk(tree)
        log.debug(
            "parsed_and_chunked",
            url=crawl_result.url,
            chunks=len(chunks),
        )
        return chunks, title

    async def _embed_and_index_batch(
        self,
        chunks: list[Chunk],
        meta: list[tuple[str, str, str, str, datetime]],
    ) -> None:
        """Embed chunks via thread pool, then index into Postgres."""
        loop = asyncio.get_event_loop()

        # Embed in thread pool (sentence-transformers is synchronous)
        await loop.run_in_executor(
            self._executor,
            self._embedder.embed_chunks,
            chunks,
            self.settings.embedder.batch_size,
        )

        # Group chunks by document URL for indexing
        doc_chunks: dict[str, tuple[str, str, str, datetime, list[Chunk]]] = {}
        for chunk, (url, service, title, content_hash, crawled_at) in zip(chunks, meta):
            if url not in doc_chunks:
                doc_chunks[url] = (service, title, content_hash, crawled_at, [])
            doc_chunks[url][4].append(chunk)

        # Index each document (skip if hash matches existing record)
        for url, (service, title, content_hash, crawled_at, doc_chunk_list) in doc_chunks.items():
            existing_hash = await self._indexer.get_document_hash(url)
            if existing_hash == content_hash:
                log.debug("document_unchanged_skipping", url=url)
                continue
            await self._indexer.index_document(
                url=url,
                service_name=service,
                title=title,
                content_hash=content_hash,
                crawled_at=crawled_at,
                chunks=doc_chunk_list,
            )

    def _resolve_seeds(self, services: list[str] | None) -> list[str]:
        if not services:
            return list(SERVICE_SEED_URLS.values())

        urls = []
        for svc in services:
            svc_lower = svc.lower()
            if svc_lower in SERVICE_SEED_URLS:
                urls.append(SERVICE_SEED_URLS[svc_lower])
            else:
                log.warning("unknown_service", service=svc)
        return urls
