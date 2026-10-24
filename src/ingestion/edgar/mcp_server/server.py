"""FastMCP tools over ingestion.edgar.queries. Thin: no SQL lives here."""

from __future__ import annotations

import os
from typing import Literal

from mcp.server.fastmcp import FastMCP

from ingestion.edgar import queries

mcp = FastMCP("edgar-spider")
_pool = None


def _dsn() -> str:
    # Duplicated from cli._dsn: importing cli would pull in click and the SEC client.
    from ingestion.config import PipelineSettings

    return os.getenv("DATABASE_URL") or PipelineSettings().database.dsn


async def _get_pool():
    global _pool
    if _pool is None:
        _pool = await queries.open_pool(_dsn())
    return _pool


@mcp.tool()
async def list_filings(ticker: str | None = None) -> list[dict]:
    """List indexed 10-K filings (id, ticker, fiscal year, fact count). Optionally one ticker."""
    return await queries.list_filings(await _get_pool(), ticker)


@mcp.tool()
async def get_facts(
    filing_id: int | None = None,
    ticker: str | None = None,
    category: Literal["revenue", "debt", "shares", "other"] | None = None,
    kind: Literal["money", "percent", "shares", "date", "entity", "text"] | None = None,
    source: Literal["ixbrl", "regex", "entity"] | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Facts extracted from a filing, in document order.

    Give filing_id, or ticker for that company's newest filing.
    category: revenue|debt|shares|other. kind: money|percent|shares|date|entity|text.
    source: ixbrl|regex|entity. limit is capped at 200. A fact's period is only in its
    `context` text; it is not structured yet.
    """
    return await queries.get_facts(
        await _get_pool(), filing_id, ticker, category, kind, source, limit, offset
    )


@mcp.tool()
async def get_provenance(filing_id: int, dom_id: str) -> dict:
    """Where a fact came from: label, section, source URL and a capped slice of the
    annotated HTML around its span. dom_id looks like f-00042 (from get_facts)."""
    prov = await queries.get_provenance(await _get_pool(), filing_id, dom_id)
    if prov is None:
        raise ValueError("fact not found")
    return prov
