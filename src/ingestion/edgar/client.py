"""SEC EDGAR HTTP client.

Follows the SEC fair-access policy (https://www.sec.gov/os/accessing-edgar-data):
a descriptive ``User-Agent`` with contact info is mandatory, and requests are
limited to 10 per second (we use 8). Everything network-free (URL building,
submissions parsing) lives in pure functions so it can be unit tested.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from typing import Self

import aiohttp
import structlog

from ingestion.crawler.rate_limiter import TokenBucketRateLimiter

log = structlog.get_logger()

WWW_BASE = "https://www.sec.gov"
DATA_BASE = "https://data.sec.gov"
TICKERS_URL = f"{WWW_BASE}/files/company_tickers.json"


class EdgarConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class FilingRef:
    accession_number: str  # with dashes, e.g. 0000320193-25-000079
    form: str
    filed_at: date | None
    report_date: date | None
    primary_document: str


@dataclass
class FetchedFiling:
    ticker: str
    cik: str
    company_name: str
    ref: FilingRef
    url: str
    html: str


def normalize_cik(cik: int | str) -> str:
    return str(int(cik)).zfill(10)


def archive_url(cik: str, accession_number: str, primary_document: str) -> str:
    """https://www.sec.gov/Archives/edgar/data/<cik int>/<accession no dashes>/<doc>"""
    return f"{WWW_BASE}/Archives/edgar/data/{int(cik)}/{accession_number.replace('-', '')}/{primary_document}"


def submissions_url(cik: str) -> str:
    return f"{DATA_BASE}/submissions/CIK{normalize_cik(cik)}.json"


def companyfacts_url(cik: str) -> str:
    return f"{DATA_BASE}/api/xbrl/companyfacts/CIK{normalize_cik(cik)}.json"


def _parse_iso(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def parse_recent_filings(submissions: dict, form: str = "10-K", limit: int = 1) -> list[FilingRef]:
    """Pick the most recent ``form`` filings out of a submissions JSON payload.

    The payload's ``filings.recent`` block is column-oriented: parallel arrays
    ``form``, ``accessionNumber``, ``filingDate``, ``reportDate``,
    ``primaryDocument``, newest first.
    """
    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    out: list[FilingRef] = []
    for i, f in enumerate(forms):
        if f != form:
            continue
        out.append(
            FilingRef(
                accession_number=recent["accessionNumber"][i],
                form=f,
                filed_at=_parse_iso(recent.get("filingDate", [None] * len(forms))[i]),
                report_date=_parse_iso(recent.get("reportDate", [None] * len(forms))[i]),
                primary_document=recent["primaryDocument"][i],
            )
        )
        if len(out) >= limit:
            break
    return out


def parse_ticker_map(payload: dict) -> dict[str, tuple[str, str]]:
    """company_tickers.json -> {TICKER: (cik, title)}. Payload is {"0": {...}, ...}."""
    out: dict[str, tuple[str, str]] = {}
    for row in payload.values():
        ticker = str(row.get("ticker", "")).upper()
        if ticker:
            out[ticker] = (normalize_cik(row["cik_str"]), str(row.get("title", "")))
    return out


class EdgarClient:
    def __init__(
        self,
        user_agent: str | None = None,
        requests_per_second: float = 8.0,
        timeout_seconds: int = 30,
    ):
        self._user_agent = user_agent or os.getenv("SEC_USER_AGENT") or ""
        if "@" not in self._user_agent:
            raise EdgarConfigError(
                "SEC requires a User-Agent with contact info. Set SEC_USER_AGENT='Name email@example.com'."
            )
        self._limiter = TokenBucketRateLimiter(rate=requests_per_second, burst=2)
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        self._session: aiohttp.ClientSession | None = None
        self._ticker_map: dict[str, tuple[str, str]] | None = None

    async def __aenter__(self) -> Self:
        self._session = aiohttp.ClientSession(
            timeout=self._timeout,
            headers={
                "User-Agent": self._user_agent,
                "Accept-Encoding": "gzip, deflate",
                "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            },
        )
        return self

    async def __aexit__(self, *exc) -> None:
        if self._session:
            await self._session.close()

    async def _get(self, url: str) -> aiohttp.ClientResponse:
        assert self._session is not None, "use 'async with EdgarClient(...)'"
        await self._limiter.acquire()
        log.debug("edgar_get", url=url)
        resp = await self._session.get(url)
        if resp.status != 200:
            body = (await resp.text())[:200]
            resp.release()
            raise RuntimeError(f"EDGAR returned {resp.status} for {url}: {body}")
        return resp

    async def get_json(self, url: str) -> dict:
        resp = await self._get(url)
        async with resp:
            return await resp.json(content_type=None)

    async def companyfacts(self, cik: str) -> dict:
        return await self.get_json(companyfacts_url(cik))

    async def get_text(self, url: str) -> str:
        resp = await self._get(url)
        async with resp:
            return await resp.text()

    async def ticker_map(self) -> dict[str, tuple[str, str]]:
        if self._ticker_map is None:
            self._ticker_map = parse_ticker_map(await self.get_json(TICKERS_URL))
        return self._ticker_map

    async def resolve(self, ticker: str) -> tuple[str, str]:
        """ticker -> (cik, company title). Raises KeyError when unknown."""
        return (await self.ticker_map())[ticker.upper()]

    async def latest_filing(self, ticker: str, form: str = "10-K") -> FetchedFiling:
        cik, title = await self.resolve(ticker)
        subs = await self.get_json(submissions_url(cik))
        refs = parse_recent_filings(subs, form=form, limit=1)
        if not refs:
            raise LookupError(f"no {form} found for {ticker} (CIK {cik})")
        ref = refs[0]
        url = archive_url(cik, ref.accession_number, ref.primary_document)
        html = await self.get_text(url)
        log.info(
            "edgar_fetched",
            ticker=ticker,
            form=form,
            accession=ref.accession_number,
            bytes=len(html),
        )
        return FetchedFiling(
            ticker=ticker.upper(),
            cik=cik,
            company_name=subs.get("name") or title,
            ref=ref,
            url=url,
            html=html,
        )
