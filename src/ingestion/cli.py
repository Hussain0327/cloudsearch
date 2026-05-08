"""CLI interface for the ingestion pipeline."""

from __future__ import annotations

import asyncio
import logging

import click
import structlog


def _setup_logging(level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
    )


@click.group()
def cli():
    """CloudSearch ingestion pipeline."""
    pass


@cli.command()
@click.option(
    "--services",
    "-s",
    multiple=True,
    help="AWS services to ingest (e.g. s3 lambda). Omit for all.",
)
@click.option(
    "--url",
    "urls",
    multiple=True,
    help="Extra seed URL(s) to crawl in addition to service-resolved seeds. Repeatable.",
)
@click.option(
    "--urls-file",
    type=click.Path(exists=True, dir_okay=False),
    default=None,
    help="File of newline-separated seed URLs (added to --url and service seeds).",
)
@click.option(
    "--max-pages",
    type=int,
    default=None,
    help="Stop after this many crawled pages have been yielded (across all services).",
)
@click.option("--log-level", default="INFO", help="Log level (DEBUG, INFO, WARNING, ERROR)")
def ingest(
    services: tuple[str, ...],
    urls: tuple[str, ...],
    urls_file: str | None,
    max_pages: int | None,
    log_level: str,
):
    """Run the full ingestion pipeline: crawl → parse → chunk → embed → index."""
    _setup_logging(log_level)
    log = structlog.get_logger()

    from ingestion.config import PipelineSettings
    from ingestion.pipeline import IngestPipeline

    settings = PipelineSettings(log_level=log_level)
    pipeline = IngestPipeline(settings)

    service_list = list(services) if services else None
    extra_urls: list[str] = list(urls)
    if urls_file:
        with open(urls_file) as f:
            extra_urls.extend(line.strip() for line in f if line.strip() and not line.startswith("#"))
    log.info(
        "starting_ingestion",
        services=service_list or "all",
        extra_urls=len(extra_urls),
        max_pages=max_pages,
    )

    stats = asyncio.run(
        pipeline.run(services=service_list, extra_urls=extra_urls or None, max_pages=max_pages)
    )

    click.echo("\n--- Ingestion Summary ---")
    for key, value in stats.items():
        click.echo(f"  {key}: {value}")


@cli.command("crawl-only")
@click.option("--services", "-s", multiple=True, help="AWS services to crawl.")
@click.option("--log-level", default="INFO")
def crawl_only(services: tuple[str, ...], log_level: str):
    """Crawl AWS docs without parsing/embedding (for testing)."""
    _setup_logging(log_level)
    log = structlog.get_logger()

    from ingestion.crawler.aws import AWSCrawler
    from ingestion.pipeline import SERVICE_SEED_URLS

    service_list = list(services) if services else None
    if service_list:
        seed_urls = [SERVICE_SEED_URLS[s.lower()] for s in service_list if s.lower() in SERVICE_SEED_URLS]
    else:
        seed_urls = list(SERVICE_SEED_URLS.values())

    async def _crawl():
        crawler = AWSCrawler()
        count = 0
        async for result in crawler.crawl(seed_urls):
            count += 1
            log.info("crawled", url=result.url, service=result.service_name)
        return count

    total = asyncio.run(_crawl())
    click.echo(f"\nCrawled {total} pages.")


@cli.command("init-db")
def init_db():
    """Run Alembic migrations to initialize the database."""
    import subprocess

    click.echo("Running alembic upgrade head...")
    result = subprocess.run(["alembic", "upgrade", "head"], capture_output=True, text=True)
    if result.returncode == 0:
        click.echo("Database initialized successfully.")
    else:
        click.echo(f"Migration failed:\n{result.stderr}", err=True)
        raise SystemExit(1)


@cli.command("stats")
def stats():
    """Show index statistics."""
    _setup_logging("WARNING")

    from ingestion.config import PipelineSettings
    from ingestion.indexer.postgres import PostgresIndexer

    settings = PipelineSettings()
    indexer = PostgresIndexer(dsn=settings.database.dsn)

    async def _stats():
        await indexer.connect()
        try:
            return await indexer.get_stats()
        finally:
            await indexer.close()

    result = asyncio.run(_stats())
    click.echo("\n--- Index Stats ---")
    click.echo(f"  Documents: {result['documents']}")
    click.echo(f"  Chunks: {result['chunks']}")
    if result["docs_per_service"]:
        click.echo("  Services:")
        for svc in sorted(result["docs_per_service"]):
            doc_cnt = result["docs_per_service"][svc]
            chunk_cnt = result["chunks_per_service"].get(svc, 0)
            click.echo(f"    {svc}: {doc_cnt} docs, {chunk_cnt} chunks")
