"""Postgres-backed tests for the filing store (need alembic revision 002)."""

from __future__ import annotations

from datetime import date
from importlib import resources

import pytest

from ingestion.edgar.extract import extract_filing
from ingestion.edgar.store import FilingMeta, FilingStore


@pytest.fixture
async def store(db_dsn):
    s = FilingStore(dsn=db_dsn, pool_min=1, pool_max=2)
    await s.connect()
    yield s
    async with s._pool.acquire() as conn:
        await conn.execute("DELETE FROM filings WHERE accession_number LIKE 'TEST-%'")
    await s.close()


def _meta(ticker: str, accession: str) -> FilingMeta:
    return FilingMeta(
        cik="0000000001",
        ticker=ticker,
        company_name=f"{ticker} Test Co",
        form_type="10-K",
        accession_number=accession,
        filed_at=date(2025, 10, 31),
        period_of_report=date(2025, 9, 27),
        fiscal_year=2025,
        source_url="https://www.sec.gov/test",
    )


@pytest.mark.db
class TestFilingStore:
    @pytest.mark.asyncio
    async def test_upsert_and_links_resolve_in_either_order(self, store):
        aapl_html = (
            resources.files("ingestion.edgar.demo").joinpath("aapl_10k_sample.htm").read_text()
        )
        msft_html = (
            resources.files("ingestion.edgar.demo").joinpath("msft_10k_sample.htm").read_text()
        )

        aapl_id = await store.upsert_filing(
            _meta("AAPL", "TEST-AAPL-1"), aapl_html, extract_filing(aapl_html, ticker="AAPL")
        )
        async with store._pool.acquire() as conn:
            # Links to MSFT are either unresolved (no MSFT filing yet) or point at
            # whichever MSFT filing already exists; never at a non-MSFT filing.
            bad = await conn.fetchval(
                """
                SELECT count(*) FROM filing_links l
                LEFT JOIN filings t ON t.id = l.target_filing_id
                WHERE l.filing_id = $1 AND l.target_ticker = 'MSFT'
                  AND l.target_filing_id IS NOT NULL AND t.ticker <> 'MSFT'
                """,
                aapl_id,
            )
            assert bad == 0

        msft_id = await store.upsert_filing(
            _meta("MSFT", "TEST-MSFT-1"), msft_html, extract_filing(msft_html, ticker="MSFT")
        )
        async with store._pool.acquire() as conn:
            # AAPL -> MSFT links got resolved after MSFT was ingested...
            target = await conn.fetchval(
                "SELECT DISTINCT target_filing_id FROM filing_links WHERE filing_id = $1 AND target_ticker = 'MSFT'",
                aapl_id,
            )
            assert target == msft_id
            # ...and MSFT -> AAPL links were resolved at insert time.
            target = await conn.fetchval(
                "SELECT DISTINCT target_filing_id FROM filing_links WHERE filing_id = $1 AND target_ticker = 'AAPL'",
                msft_id,
            )
            assert target == aapl_id
            fact_count = await conn.fetchval(
                "SELECT fact_count FROM filings WHERE id = $1", aapl_id
            )
            facts = await conn.fetchval("SELECT count(*) FROM facts WHERE filing_id = $1", aapl_id)
            assert fact_count == facts > 0

    @pytest.mark.asyncio
    async def test_reingest_replaces_rows(self, store):
        html = resources.files("ingestion.edgar.demo").joinpath("msft_10k_sample.htm").read_text()
        result = extract_filing(html, ticker="MSFT")
        first = await store.upsert_filing(_meta("MSFT", "TEST-MSFT-2"), html, result)
        second = await store.upsert_filing(_meta("MSFT", "TEST-MSFT-2"), html, result)
        assert second != first
        async with store._pool.acquire() as conn:
            assert (
                await conn.fetchval(
                    "SELECT count(*) FROM filings WHERE accession_number = 'TEST-MSFT-2'"
                )
                == 1
            )
            assert (
                await conn.fetchval("SELECT count(*) FROM facts WHERE filing_id = $1", first) == 0
            )
