"""`python -m ingestion edgar ...` commands."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import date
from importlib import resources
from pathlib import Path

import click
import structlog

from ingestion.edgar.universe import DEFAULT_TICKERS, company_for

log = structlog.get_logger()

DEMO_FILINGS = (
    # (resource file, ticker, accession number, filed_at, source_url)
    (
        "aapl_10k_sample.htm",
        "AAPL",
        "0000320193-25-000079",
        date(2025, 10, 31),
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    ),
    (
        "msft_10k_sample.htm",
        "MSFT",
        "0000950170-25-098019",
        date(2025, 7, 30),
        "https://www.sec.gov/Archives/edgar/data/789019/000095017025098019/msft-20250630.htm",
    ),
)


def _dsn() -> str:
    from ingestion.config import PipelineSettings

    return os.getenv("DATABASE_URL") or PipelineSettings().database.dsn


@click.group()
def edgar():
    """SEC EDGAR: fetch 10-K filings and extract facts for the spider viewer."""


@edgar.command("ingest")
@click.option(
    "--tickers", "-t", multiple=True, help="Tickers to ingest. Default: the whole universe."
)
@click.option("--form", default="10-K", show_default=True, help="Form type to fetch.")
@click.option(
    "--user-agent", default=None, help="Overrides SEC_USER_AGENT ('Name email@example.com')."
)
@click.option("--dry-run", is_flag=True, help="Fetch and extract but do not write to Postgres.")
def ingest(tickers: tuple[str, ...], form: str, user_agent: str | None, dry_run: bool):
    """Fetch each ticker's latest filing from EDGAR, extract facts, store them."""
    from ingestion.edgar.client import EdgarClient
    from ingestion.edgar.extract import FilingExtractor
    from ingestion.edgar.store import FilingMeta, FilingStore

    wanted = [t.upper() for t in tickers] or list(DEFAULT_TICKERS)
    extractor = FilingExtractor()

    async def _run() -> list[dict]:
        summary: list[dict] = []
        store = None
        if not dry_run:
            store = FilingStore(_dsn())
            await store.connect()
        try:
            async with EdgarClient(user_agent=user_agent) as client:
                for ticker in wanted:
                    try:
                        fetched = await client.latest_filing(ticker, form=form)
                    except Exception as exc:  # noqa: BLE001 - report and continue
                        log.error("edgar_fetch_failed", ticker=ticker, error=str(exc))
                        summary.append({"ticker": ticker, "error": str(exc)})
                        continue
                    result = extractor.extract(fetched.html, ticker=ticker, source_url=fetched.url)
                    row = {
                        "ticker": ticker,
                        "accession": fetched.ref.accession_number,
                        "facts": len(result.facts),
                        "links": len(result.links),
                        **result.counts,
                    }
                    if store is not None:
                        known = company_for(ticker)
                        meta = FilingMeta(
                            cik=fetched.cik,
                            ticker=ticker,
                            company_name=result.company_name
                            or fetched.company_name
                            or (known.name if known else ticker),
                            form_type=form,
                            accession_number=fetched.ref.accession_number,
                            filed_at=fetched.ref.filed_at,
                            period_of_report=result.period_of_report or fetched.ref.report_date,
                            fiscal_year=result.fiscal_year,
                            source_url=fetched.url,
                        )
                        row["filing_id"] = await store.upsert_filing(meta, fetched.html, result)
                    summary.append(row)
        finally:
            if store is not None:
                await store.close()
        return summary

    rows = asyncio.run(_run())
    click.echo("\n--- EDGAR ingest summary ---")
    for row in rows:
        click.echo("  " + json.dumps(row, default=str))


@edgar.command("extract-file")
@click.argument("path", type=click.Path(exists=True, dir_okay=False))
@click.option("--ticker", default=None, help="Filer ticker (excluded from company-mention links).")
@click.option(
    "--json", "as_json", is_flag=True, help="Print facts as JSON lines instead of a table."
)
@click.option(
    "--out", type=click.Path(dir_okay=False), default=None, help="Write the annotated HTML here."
)
def extract_file(path: str, ticker: str | None, as_json: bool, out: str | None):
    """Run the extractor on a local filing (offline) and print what it finds."""
    from ingestion.edgar.extract import FilingExtractor

    html = Path(path).read_text(encoding="utf-8", errors="replace")
    result = FilingExtractor().extract(html, ticker=ticker)
    if out:
        Path(out).write_text(result.annotated_html, encoding="utf-8")
    if as_json:
        for fact in result.facts:
            click.echo(json.dumps(fact.to_dict(), default=str))
    else:
        click.echo(
            f"{result.company_name or '?'}  period={result.period_of_report}  facts={len(result.facts)}  {result.counts}"
        )
        for fact in result.facts:
            value = (
                "" if fact.value_numeric is None else f"{fact.value_numeric:g} {fact.unit or ''}"
            )
            click.echo(
                f"  {fact.fact_index:4d} {fact.section:8s} {fact.category:7s} {fact.kind:7s} {fact.raw_text[:28]!r:32} {fact.label[:40]:40s} {value}"
            )
        if result.links:
            click.echo(
                "  links: "
                + ", ".join(f"{l.mention_text}->{l.target_ticker}" for l in result.links)
            )


@edgar.command("seed-demo")
def seed_demo():
    """Load the bundled synthetic 10-K samples into Postgres (offline demo)."""
    from ingestion.edgar.extract import FilingExtractor
    from ingestion.edgar.store import FilingMeta, FilingStore

    extractor = FilingExtractor()

    async def _run() -> None:
        store = FilingStore(_dsn())
        await store.connect()
        try:
            for resource_name, ticker, accession, filed_at, url in DEMO_FILINGS:
                html = (
                    resources.files("ingestion.edgar.demo")
                    .joinpath(resource_name)
                    .read_text(encoding="utf-8")
                )
                result = extractor.extract(html, ticker=ticker, source_url=url)
                company = company_for(ticker)
                meta = FilingMeta(
                    cik=company.cik if company else "0000000000",
                    ticker=ticker,
                    company_name=result.company_name or (company.name if company else ticker),
                    form_type="10-K",
                    accession_number=accession,
                    filed_at=filed_at,
                    period_of_report=result.period_of_report,
                    fiscal_year=result.fiscal_year,
                    source_url=url,
                )
                filing_id = await store.upsert_filing(meta, html, result)
                click.echo(
                    f"  seeded {ticker}: filing_id={filing_id} facts={len(result.facts)} links={len(result.links)} {result.counts}"
                )
        finally:
            await store.close()

    click.echo("Seeding demo filings (synthetic samples; run `edgar ingest` for real ones)...")
    asyncio.run(_run())
