"""Persist filings, facts and links to Postgres (alembic revision 002)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date

import structlog

from ingestion.edgar.extract import ExtractionResult

log = structlog.get_logger()


@dataclass
class FilingMeta:
    cik: str
    ticker: str
    company_name: str
    form_type: str
    accession_number: str
    filed_at: date | None
    period_of_report: date | None
    fiscal_year: int | None
    source_url: str


class FilingStore:
    def __init__(self, dsn: str, pool_min: int = 1, pool_max: int = 4):
        self._dsn = dsn
        self._pool_min = pool_min
        self._pool_max = pool_max
        self._pool = None

    async def connect(self) -> None:
        import asyncpg

        self._pool = await asyncpg.create_pool(
            self._dsn, min_size=self._pool_min, max_size=self._pool_max
        )
        log.info("filing_store_connected", dsn=self._dsn.split("@")[-1])

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def upsert_filing(self, meta: FilingMeta, raw_html: str, result: ExtractionResult) -> int:
        """Replace any existing row for the accession number and return the filing id.

        Facts and links are inserted in one transaction. Links to tickers that
        are already indexed get their ``target_filing_id`` resolved now; links
        in other filings that point at this ticker are resolved afterwards, so
        ingest order does not matter.
        """
        content_hash = hashlib.sha256(raw_html.encode("utf-8", "replace")).hexdigest()
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "DELETE FROM filings WHERE accession_number = $1", meta.accession_number
            )
            filing_id = await conn.fetchval(
                """
                INSERT INTO filings (cik, ticker, company_name, form_type, accession_number,
                                     filed_at, period_of_report, fiscal_year, source_url,
                                     content_hash, raw_html, annotated_html, fact_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id
                """,
                meta.cik,
                meta.ticker.upper(),
                meta.company_name,
                meta.form_type,
                meta.accession_number,
                meta.filed_at,
                meta.period_of_report,
                meta.fiscal_year,
                meta.source_url,
                content_hash,
                raw_html,
                result.annotated_html,
                len(result.facts),
            )
            if result.facts:
                await conn.executemany(
                    """
                    INSERT INTO facts (filing_id, fact_index, dom_id, category, kind, raw_text,
                                       label, value_numeric, unit, context, section, concept, source)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    """,
                    [
                        (
                            filing_id,
                            f.fact_index,
                            f.dom_id,
                            f.category,
                            f.kind,
                            f.raw_text,
                            f.label,
                            f.value_numeric,
                            f.unit,
                            f.context,
                            f.section,
                            f.concept,
                            f.source,
                        )
                        for f in result.facts
                    ],
                )
            if result.links:
                await conn.executemany(
                    """
                    INSERT INTO filing_links (filing_id, fact_index, dom_id, target_ticker,
                                              target_filing_id, mention_text)
                    VALUES ($1, $2, $3, $4,
                            (SELECT id FROM filings WHERE ticker = $4 AND id <> $1
                             ORDER BY filed_at DESC NULLS LAST, id DESC LIMIT 1),
                            $5)
                    """,
                    [
                        (filing_id, l.fact_index, l.dom_id, l.target_ticker, l.mention_text)
                        for l in result.links
                    ],
                )
            # Resolve links from other filings that mention this company.
            await conn.execute(
                """
                UPDATE filing_links SET target_filing_id = $1
                WHERE target_ticker = $2 AND filing_id <> $1
                """,
                filing_id,
                meta.ticker.upper(),
            )
        log.info(
            "filing_indexed",
            ticker=meta.ticker,
            accession=meta.accession_number,
            filing_id=filing_id,
            facts=len(result.facts),
            links=len(result.links),
        )
        return filing_id

    async def list_filings(self) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, ticker, company_name, form_type, accession_number, filed_at,
                       period_of_report, fiscal_year, fact_count
                FROM filings ORDER BY ticker, filed_at DESC NULLS LAST
                """
            )
            return [dict(r) for r in rows]
