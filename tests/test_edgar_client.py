"""Network-free tests for the EDGAR client helpers."""

from __future__ import annotations

import pytest

from ingestion.edgar.client import (
    EdgarClient,
    EdgarConfigError,
    archive_url,
    normalize_cik,
    parse_recent_filings,
    parse_ticker_map,
    submissions_url,
)


def test_normalize_cik():
    assert normalize_cik(320193) == "0000320193"
    assert normalize_cik("0000320193") == "0000320193"


def test_urls():
    assert submissions_url("320193") == "https://data.sec.gov/submissions/CIK0000320193.json"
    assert (
        archive_url("0000320193", "0000320193-25-000079", "aapl-20250927.htm")
        == "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm"
    )


def test_parse_recent_filings_picks_newest_matching_form():
    payload = {
        "name": "Apple Inc.",
        "filings": {
            "recent": {
                "form": ["8-K", "10-K", "10-Q", "10-K"],
                "accessionNumber": ["a", "0000320193-25-000079", "c", "0000320193-24-000123"],
                "filingDate": ["2025-11-01", "2025-10-31", "2025-08-01", "2024-11-01"],
                "reportDate": ["2025-10-30", "2025-09-27", "2025-06-28", "2024-09-28"],
                "primaryDocument": ["x.htm", "aapl-20250927.htm", "q.htm", "aapl-20240928.htm"],
            }
        },
    }
    refs = parse_recent_filings(payload, form="10-K", limit=2)
    assert [r.accession_number for r in refs] == ["0000320193-25-000079", "0000320193-24-000123"]
    assert str(refs[0].filed_at) == "2025-10-31"
    assert str(refs[0].report_date) == "2025-09-27"
    assert refs[0].primary_document == "aapl-20250927.htm"
    assert parse_recent_filings(payload, form="20-F") == []


def test_parse_ticker_map():
    payload = {
        "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        "1": {"cik_str": 789019, "ticker": "msft", "title": "MICROSOFT CORP"},
    }
    m = parse_ticker_map(payload)
    assert m["AAPL"] == ("0000320193", "Apple Inc.")
    assert m["MSFT"][0] == "0000789019"


def test_user_agent_is_required(monkeypatch):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    with pytest.raises(EdgarConfigError):
        EdgarClient()
    EdgarClient(user_agent="CloudSearch dev dev@example.com")  # ok
