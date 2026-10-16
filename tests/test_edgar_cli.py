"""CLI smoke tests for `python -m ingestion edgar ...` (offline commands only)."""

from __future__ import annotations

import json
from importlib import resources

from click.testing import CliRunner

from ingestion.cli import cli


def _sample_path() -> str:
    return str(resources.files("ingestion.edgar.demo").joinpath("aapl_10k_sample.htm"))


def test_edgar_group_is_registered():
    result = CliRunner().invoke(cli, ["edgar", "--help"])
    assert result.exit_code == 0
    for cmd in ("ingest", "extract-file", "seed-demo"):
        assert cmd in result.output


def test_extract_file_table_output():
    result = CliRunner().invoke(cli, ["edgar", "extract-file", _sample_path(), "--ticker", "AAPL"])
    assert result.exit_code == 0, result.output
    assert "Apple Inc." in result.output
    assert "Notes due 2042" in result.output
    assert "links:" in result.output and "Microsoft->MSFT" in result.output


def test_extract_file_json_and_annotated_output(tmp_path):
    out = tmp_path / "annotated.htm"
    result = CliRunner().invoke(
        cli,
        ["edgar", "extract-file", _sample_path(), "--ticker", "AAPL", "--json", "--out", str(out)],
    )
    assert result.exit_code == 0, result.output
    rows = [json.loads(line) for line in result.output.splitlines() if line.startswith("{")]
    assert rows and rows[0]["dom_id"] == "f-00000"
    assert {r["category"] for r in rows} == {"revenue", "debt", "shares", "other"}
    html = out.read_text(encoding="utf-8")
    assert html.count('class="cs-fact"') == len(rows)
