"""Offline round-trip tests for `edgar export`."""

from __future__ import annotations

import hashlib
import json
from importlib import resources

import pyarrow.parquet as pq
from click.testing import CliRunner

from ingestion.cli import cli
from ingestion.edgar.export import FACTS_SCHEMA, FILINGS_SCHEMA, SCHEMA_VERSION
from ingestion.edgar.extract import FilingExtractor

SAMPLE = resources.files("ingestion.edgar.demo").joinpath("aapl_10k_sample.htm")
ACC = "0000320193-25-000079"


def _run(out, *extra):
    args = ["edgar", "export", "--from-file", str(SAMPLE), "--ticker", "aapl"]
    return CliRunner().invoke(cli, [*args, "--accession", ACC, "--out", str(out), *extra])


def test_export_round_trip(tmp_path):
    result = _run(tmp_path)
    assert result.exit_code == 0, result.output
    expected = FilingExtractor().extract(SAMPLE.read_text(encoding="utf-8"), ticker="AAPL")
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    facts = pq.read_table(tmp_path / "facts")
    assert facts.num_rows == len(expected.facts) == manifest["rows"]["facts"]
    assert set(facts.schema.names) == set(FACTS_SCHEMA.names)
    years = set(facts.column("fiscal_year").to_pylist())
    assert years == {expected.fiscal_year}
    filings = pq.read_table(tmp_path / "filings.parquet")
    assert filings.schema.equals(FILINGS_SCHEMA)
    row = filings.to_pylist()[0]
    assert row["ticker"] == "AAPL" and row["accession_number"] == ACC
    assert row["cik"] == "0000320193" and row["fact_count"] == facts.num_rows

    assert manifest["schema_version"] == SCHEMA_VERSION
    assert manifest["source"] == "U.S. SEC EDGAR"
    assert manifest["status"] == "experimental, unscored"
    assert manifest["truncated"] is False
    assert len(manifest["files"]) == 2
    for rel, digest in manifest["files"].items():
        assert hashlib.sha256((tmp_path / rel).read_bytes()).hexdigest() == digest


def test_export_truncated_flag(tmp_path):
    assert _run(tmp_path, "--max-facts", "3").exit_code == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["truncated"] is True
    assert manifest["rows"]["facts"] == 3
