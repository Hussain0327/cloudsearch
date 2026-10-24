"""Read-only queries over filings and facts (alembic revision 002).

Every statement is parameterized and the connection is opened with
``default_transaction_read_only=on``, so a bug here cannot write.
"""

from __future__ import annotations

import re

MAX_LIMIT = 200
MAX_HTML_CHARS = 20_000
_DOM_ID = re.compile(r"f-\d{5,}")


async def open_pool(dsn: str):
    """Opens a small read-only asyncpg pool."""
    import asyncpg

    return await asyncpg.create_pool(
        dsn,
        min_size=1,
        max_size=2,
        server_settings={"default_transaction_read_only": "on"},
    )


def _page(limit: int, offset: int) -> tuple[int, int]:
    return max(1, min(limit, MAX_LIMIT)), max(0, offset)


def _slice(html: str, dom_id: str, max_chars: int = MAX_HTML_CHARS) -> str | None:
    """Returns up to max_chars of html centred on the fact's span, or None."""
    # bs4 sorts attributes (class, data-category, data-fact-id, data-kind, id), so anchor on
    # the data-fact-id value alone, then back up to the span's opening tag.
    hit = html.find(f'data-fact-id="{dom_id}"')
    start = html.rfind("<span", 0, hit) if hit >= 0 else -1
    if start < 0:
        return None
    half = max(1, min(max_chars, MAX_HTML_CHARS)) // 2
    return html[max(0, start - half) : start + half]


async def list_filings(pool, ticker: str | None = None) -> list[dict]:
    """Lists indexed filings, optionally for one ticker."""
    rows = await pool.fetch(
        """
        SELECT id, ticker, company_name, form_type, accession_number, filed_at,
               period_of_report, fiscal_year, fact_count, source_url
        FROM filings
        WHERE ($1::text IS NULL OR ticker = upper($1))
        ORDER BY ticker, filed_at DESC NULLS LAST
        """,
        ticker,
    )
    return [dict(r) for r in rows]


async def get_facts(
    pool,
    filing_id: int | None = None,
    ticker: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    source: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Returns facts in document order.

    ``ticker`` means that ticker's newest filing unless ``filing_id`` is given.
    """
    if filing_id is None and ticker is None:
        raise ValueError("give filing_id or ticker")
    limit, offset = _page(limit, offset)
    rows = await pool.fetch(
        """
        SELECT f.filing_id, f.fact_index, f.dom_id, f.category, f.kind, f.raw_text,
               f.label, f.value_numeric, f.unit, f.context, f.section, f.concept, f.source
        FROM facts f
        WHERE f.filing_id = COALESCE(
                $1::bigint,
                (SELECT id FROM filings WHERE ticker = upper($2::text)
                 ORDER BY filed_at DESC NULLS LAST, id DESC LIMIT 1))
          AND ($3::text IS NULL OR f.category = $3)
          AND ($4::text IS NULL OR f.kind = $4)
          AND ($5::text IS NULL OR f.source = $5)
        ORDER BY f.fact_index
        LIMIT $6 OFFSET $7
        """,
        filing_id,
        ticker,
        category,
        kind,
        source,
        limit,
        offset,
    )
    return [dict(r) for r in rows]


async def get_provenance(
    pool, filing_id: int, dom_id: str, max_chars: int = MAX_HTML_CHARS
) -> dict | None:
    """Returns a fact plus a capped slice of annotated HTML around its span."""
    # shortcut: fetches the whole annotated_html and slices in Python; move to SQL
    # substring() if multi-MB filings make this slow.
    if not _DOM_ID.fullmatch(dom_id):
        raise ValueError(f"bad dom_id: {dom_id!r}")
    row = await pool.fetchrow(
        """
        SELECT f.fact_index, f.dom_id, f.raw_text, f.label, f.context, f.section,
               fl.source_url, fl.ticker, fl.accession_number, fl.annotated_html
        FROM facts f JOIN filings fl ON fl.id = f.filing_id
        WHERE f.filing_id = $1 AND f.dom_id = $2
        """,
        filing_id,
        dom_id,
    )
    if row is None:
        return None
    out = dict(row)
    out["annotated_html"] = _slice(out["annotated_html"], dom_id, max_chars)
    return out
