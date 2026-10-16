"""The v1 company universe and the name patterns used to detect mentions."""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Company:
    ticker: str
    cik: str  # zero-padded 10 digits
    name: str
    # Case-sensitive name forms that identify the company in prose. Kept
    # conservative on purpose: "Apple" matches, "apple" (the fruit) does not.
    aliases: tuple[str, ...] = field(default_factory=tuple)


UNIVERSE: dict[str, Company] = {
    "AAPL": Company("AAPL", "0000320193", "Apple Inc.", ("Apple Inc.", "Apple")),
    "MSFT": Company(
        "MSFT", "0000789019", "Microsoft Corporation", ("Microsoft Corporation", "Microsoft")
    ),
    "AMZN": Company("AMZN", "0001018724", "Amazon.com, Inc.", ("Amazon.com", "Amazon")),
    "GOOGL": Company(
        "GOOGL", "0001652044", "Alphabet Inc.", ("Alphabet Inc.", "Alphabet", "Google")
    ),
    "NVDA": Company(
        "NVDA", "0001045810", "NVIDIA Corporation", ("NVIDIA Corporation", "NVIDIA", "Nvidia")
    ),
}

DEFAULT_TICKERS: tuple[str, ...] = tuple(UNIVERSE.keys())


def company_for(ticker: str) -> Company | None:
    return UNIVERSE.get(ticker.upper())


@dataclass(frozen=True)
class MentionMatcher:
    """A compiled alias regex plus the named-group -> ticker mapping."""

    pattern: re.Pattern[str]
    group_tickers: dict[str, str]

    def finditer(self, text: str):
        return self.pattern.finditer(text)

    def ticker_for(self, match: re.Match[str]) -> str:
        for group, ticker in self.group_tickers.items():
            if match.group(group) is not None:
                return ticker
        raise ValueError("match did not come from this matcher")


def mention_regex(exclude_ticker: str | None = None) -> MentionMatcher:
    """Matcher for any universe alias (longest first) except the filer's own.

    Word-bounded so "Applewood" does not match "Apple". Alternation is sorted
    longest-first so "Apple Inc." wins over "Apple" at the same position.
    """
    aliases: list[tuple[str, str]] = []
    for company in UNIVERSE.values():
        if exclude_ticker and company.ticker == exclude_ticker.upper():
            continue
        for alias in company.aliases:
            aliases.append((alias, company.ticker))
    aliases.sort(key=lambda a: len(a[0]), reverse=True)
    pattern = "|".join(f"(?P<t{i}>{re.escape(alias)})" for i, (alias, _) in enumerate(aliases))
    compiled = re.compile(rf"(?<![A-Za-z0-9])(?:{pattern})(?![A-Za-z0-9])")
    return MentionMatcher(compiled, {f"t{i}": ticker for i, (_, ticker) in enumerate(aliases)})
