"""Pure inline-XBRL parsing shared by the eval harness (and later the extractor).

Reads a BeautifulSoup tree parsed with ``lxml`` (so tag and attribute names are
lowercased) and returns plain dataclasses. No I/O, no database.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

_HIDDEN_PARENTS = ("ix:header", "ix:hidden", "ix:resources")
_NESTING_PARENTS = ("ix:nonfraction", "ix:nonnumeric")
_DASHES = {"-", "—", "–"}


@dataclass(frozen=True)
class Period:
    """A context's period. ``start`` is None for an instant, whose date is ``end``."""

    start: str | None
    end: str
    instant: bool
    dimensional: bool


@dataclass(frozen=True)
class IxObservation:
    """One ``ix:nonfraction`` tag, wrapped by the extractor or not."""

    name: str
    contextref: str | None
    unitref: str | None
    decimals: float | None  # math.inf for decimals="INF"
    scale: int
    sign: str | None
    format: str | None
    displayed: str
    value: float | None  # displayed number * 10**scale, negated for sign="-"
    ix_id: str | None
    dom_id: str | None  # data-fact-id of the wrapping cs-fact span, if any
    hidden: bool
    nested: bool


def _text(tag: Tag | None) -> str:
    return tag.get_text(strip=True) if tag else ""


def parse_contexts(soup: BeautifulSoup) -> dict[str, Period]:
    """Maps context id to Period for every xbrli:context in the document."""
    out: dict[str, Period] = {}
    for ctx in soup.find_all("xbrli:context"):
        cid = ctx.get("id")
        instant = _text(ctx.find("xbrli:instant"))
        end = _text(ctx.find("xbrli:enddate"))
        start = _text(ctx.find("xbrli:startdate"))
        if not cid or not (instant or end):
            continue
        dimensional = ctx.find(["xbrldi:explicitmember", "xbrldi:typedmember"]) is not None
        if instant:
            out[cid] = Period(None, instant, True, dimensional)
        else:
            out[cid] = Period(start or None, end, False, dimensional)
    return out


def _measure(tag: Tag | None) -> str:
    # "iso4217:USD" -> "USD", "xbrli:shares" -> "shares"
    return _text(tag.find("xbrli:measure") if tag else None).split(":")[-1]


def parse_units(soup: BeautifulSoup) -> dict[str, str]:
    """Maps unit id to measure, e.g. "USD" or "USD/shares" for a divide unit."""
    out: dict[str, str] = {}
    for unit in soup.find_all("xbrli:unit"):
        uid = unit.get("id")
        if not uid:
            continue
        divide = unit.find("xbrli:divide")
        if divide:
            num = _measure(divide.find("xbrli:unitnumerator"))
            den = _measure(divide.find("xbrli:unitdenominator"))
            out[uid] = f"{num}/{den}"
        else:
            out[uid] = _measure(unit)
    return out


def _displayed_number(text: str, fmt: str | None) -> float | None:
    fmt = (fmt or "").lower()
    cleaned = text.replace("\xa0", "").replace(" ", "").strip()
    if not cleaned:
        return None
    if "fixed-zero" in fmt or "zerodash" in fmt or cleaned in _DASHES:
        return 0.0
    if "comma-decimal" in fmt or "numcommadecimal" in fmt:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _decimals(raw: str | None) -> float | None:
    if raw is None:
        return None
    if raw.strip().upper() == "INF":
        return math.inf
    try:
        return float(raw)
    except ValueError:
        return None


def _is_hidden(tag: Tag) -> bool:
    for parent in tag.parents:
        if parent.name in _HIDDEN_PARENTS:
            return True
        style = parent.get("style") if isinstance(parent, Tag) else None
        if isinstance(style, str) and "display:none" in re.sub(r"\s", "", style).lower():
            return True
    return False


def observations(soup: BeautifulSoup) -> list[IxObservation]:
    """Every ``ix:nonfraction`` in document order, wrapped or not."""
    out: list[IxObservation] = []
    for tag in soup.find_all("ix:nonfraction"):
        displayed = tag.get_text(" ", strip=True)
        fmt = tag.get("format")
        number = _displayed_number(displayed, fmt)
        try:
            scale = int(tag.get("scale") or 0)
        except ValueError:
            scale = 0
        sign = tag.get("sign")
        value = None if number is None else number * 10.0**scale
        if value is not None and sign == "-":
            value = -value
        parent = tag.parent
        wrapped = isinstance(parent, Tag) and "cs-fact" in (parent.get("class") or [])
        out.append(
            IxObservation(
                name=tag.get("name") or "",
                contextref=tag.get("contextref"),
                unitref=tag.get("unitref"),
                decimals=_decimals(tag.get("decimals")),
                scale=scale,
                sign=sign,
                format=fmt,
                displayed=displayed,
                value=value,
                ix_id=tag.get("id"),
                dom_id=parent.get("data-fact-id") if wrapped else None,
                hidden=_is_hidden(tag),
                nested=any(p.name in _NESTING_PARENTS for p in tag.parents),
            )
        )
    return out
