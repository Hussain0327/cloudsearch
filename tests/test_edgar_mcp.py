"""Tests for the EDGAR MCP server and its read-only queries."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date
from importlib import resources
from pathlib import Path

import pytest

pytest.importorskip("mcp")

from ingestion.edgar import queries
from ingestion.edgar.extract import extract_filing
from ingestion.edgar.mcp_server.server import mcp
from ingestion.edgar.store import FilingMeta, FilingStore

SRC = str(Path(__file__).resolve().parents[1] / "src")
TOOLS = {"list_filings", "get_facts", "get_provenance"}


async def test_tool_list_and_schemas():
    tools = {t.name: t for t in await mcp.list_tools()}
    assert set(tools) == TOOLS
    props = tools["get_facts"].inputSchema["properties"]
    assert {"filing_id", "ticker", "category", "kind", "source", "limit", "offset"} <= set(props)
    assert props["category"]["anyOf"][0]["enum"] == ["revenue", "debt", "shares", "other"]
    assert props["source"]["anyOf"][0]["enum"] == ["ixbrl", "regex", "entity"]
    assert set(tools["get_provenance"].inputSchema["required"]) == {"filing_id", "dom_id"}


def test_stdio_stdout_has_only_jsonrpc_frames():
    """No DB needed: initialize + tools/list must not touch Postgres."""
    frames = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "0"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    ]
    proc = subprocess.run(
        [sys.executable, "-m", "ingestion.edgar.mcp_server"],
        input="".join(json.dumps(f) + "\n" for f in frames),
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "PYTHONPATH": SRC},
    )
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    msgs = [json.loads(ln) for ln in lines]  # raises if anything non-JSON hit stdout
    assert all(m.get("jsonrpc") == "2.0" for m in msgs)
    listed = next(m for m in msgs if m.get("id") == 2)
    assert {t["name"] for t in listed["result"]["tools"]} == TOOLS


def test_paging_is_capped():
    assert queries._page(10_000, -5) == (queries.MAX_LIMIT, 0)
    assert queries._page(0, 3) == (1, 3)


def test_slice_finds_every_demo_fact():
    html = resources.files("ingestion.edgar.demo").joinpath("aapl_10k_sample.htm").read_text()
    result = extract_filing(html, ticker="MCPT")
    facts = result.facts
    assert facts
    for f in facts:
        got = queries._slice(result.annotated_html, f.dom_id, 500)
        assert got is not None and len(got) <= 500
        assert f'data-fact-id="{f.dom_id}"' in got
    assert queries._slice(result.annotated_html, "f-99999") is None


async def test_get_facts_requires_filing_or_ticker():
    with pytest.raises(ValueError):
        await queries.get_facts(None)


async def test_provenance_rejects_bad_dom_id():
    with pytest.raises(ValueError):
        await queries.get_provenance(None, 1, 'x" OR 1=1')


@pytest.fixture
async def pool(db_dsn):
    store = FilingStore(dsn=db_dsn, pool_min=1, pool_max=2)
    await store.connect()
    html = resources.files("ingestion.edgar.demo").joinpath("aapl_10k_sample.htm").read_text()
    meta = FilingMeta(
        cik="0000000001",
        ticker="MCPT",
        company_name="MCP Test Co",
        form_type="10-K",
        accession_number="TEST-MCP-1",
        filed_at=date(2025, 10, 31),
        period_of_report=date(2025, 9, 27),
        fiscal_year=2025,
        source_url="https://www.sec.gov/test",
    )
    await store.upsert_filing(meta, html, extract_filing(html, ticker="MCPT"))
    p = await queries.open_pool(db_dsn)
    yield p
    await p.close()
    async with store._pool.acquire() as conn:
        await conn.execute("DELETE FROM filings WHERE accession_number LIKE 'TEST-MCP-%'")
    await store.close()


@pytest.mark.db
async def test_queries_against_postgres(pool):
    filings = await queries.list_filings(pool, "mcpt")
    assert len(filings) == 1
    fid = filings[0]["id"]

    facts = await queries.get_facts(pool, ticker="mcpt", limit=3)
    assert 0 < len(facts) <= 3
    money = await queries.get_facts(pool, filing_id=fid, kind="money", limit=1000)
    assert money and all(f["kind"] == "money" for f in money)
    paged = await queries.get_facts(pool, filing_id=fid, limit=2, offset=1)
    assert paged[0]["fact_index"] == (await queries.get_facts(pool, filing_id=fid))[1]["fact_index"]

    prov = await queries.get_provenance(pool, fid, facts[0]["dom_id"], max_chars=500)
    assert f'data-fact-id="{facts[0]["dom_id"]}"' in prov["annotated_html"]
    assert len(prov["annotated_html"]) <= 500
    assert await queries.get_provenance(pool, fid, "f-99999") is None

    with pytest.raises(Exception, match="read-only"):
        await pool.execute("DELETE FROM filings")
