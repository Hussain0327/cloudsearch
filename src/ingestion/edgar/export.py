"""Offline export of extracted EDGAR facts to Parquet (open-dataset MVP).

Imports pyarrow at module level, so import this module lazily (the CLI does).
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import date
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from ingestion.edgar.extract import ExtractionResult

SCHEMA_VERSION = 1
SOURCE = "U.S. SEC EDGAR"

FACTS_SCHEMA = pa.schema(
    [
        ("ticker", pa.string()),
        ("accession_number", pa.string()),
        ("fiscal_year", pa.int32()),  # logical column; stored in the facts/ partition path
        ("fact_index", pa.int32()),
        ("dom_id", pa.string()),
        ("category", pa.string()),
        ("kind", pa.string()),
        ("raw_text", pa.string()),
        ("label", pa.string()),
        ("value_numeric", pa.float64()),
        ("unit", pa.string()),
        ("context", pa.string()),
        ("section", pa.string()),
        ("concept", pa.string()),
        ("source", pa.string()),
    ]
)

FILINGS_SCHEMA = pa.schema(
    [
        ("ticker", pa.string()),
        ("cik", pa.string()),
        ("accession_number", pa.string()),
        ("company_name", pa.string()),
        ("period_of_report", pa.date32()),
        ("fiscal_year", pa.int32()),
        ("fact_count", pa.int32()),
    ]
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_filing(
    result: ExtractionResult,
    *,
    ticker: str,
    accession: str,
    cik: str | None,
    out_dir: Path,
    max_facts: int,
) -> dict:
    """Writes facts/, filings.parquet and manifest.json under out_dir; returns the manifest."""
    year = result.fiscal_year
    key = {"ticker": ticker, "accession_number": accession, "fiscal_year": year}
    rows = [{**key, **f.to_dict()} for f in result.facts]
    # shortcut: single-filing export, replace with manifest merge for multi-filing
    if (out_dir / "facts").exists():
        shutil.rmtree(out_dir / "facts")
    # Known year: fiscal_year lives in the hive path only (repeating it in the file breaks
    # dataset reads). Unknown year: no partition dir (a lone null partition cannot be typed),
    # so the file keeps an all-null fiscal_year column instead.
    if year is not None:
        facts_dir = out_dir / "facts" / f"fiscal_year={year}"
        leaf = pa.schema([f for f in FACTS_SCHEMA if f.name != "fiscal_year"])
    else:
        facts_dir = out_dir / "facts"
        leaf = FACTS_SCHEMA
    facts_dir.mkdir(parents=True, exist_ok=True)
    facts_path = facts_dir / "facts.parquet"
    pq.write_table(pa.Table.from_pylist(rows, schema=leaf), facts_path)

    period: date | None = result.period_of_report
    filing = {
        "ticker": ticker,
        "cik": cik,
        "accession_number": accession,
        "company_name": result.company_name,
        "period_of_report": period,
        "fiscal_year": year,
        "fact_count": len(rows),
    }
    filings_path = out_dir / "filings.parquet"
    pq.write_table(pa.Table.from_pylist([filing], schema=FILINGS_SCHEMA), filings_path)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "status": "experimental, unscored",
        "source": SOURCE,
        "truncated": len(rows) >= max_facts,
        "max_facts": max_facts,
        "rows": {"facts": len(rows), "filings": 1},
        "files": {str(p.relative_to(out_dir)): _sha256(p) for p in (facts_path, filings_path)},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest
