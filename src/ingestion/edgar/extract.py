"""Extract facts from a 10-K and produce annotated HTML.

Two passes over the document, in document order:

1. Inline XBRL. Every ``ix:nonFraction`` (numbers) and the handful of useful
   ``ix:nonNumeric`` cover-page tags carry a concept name, so these facts are
   exact and classified by concept (``classify.classify_concept``).
2. Regex over the remaining text nodes for figures that are not tagged:
   "3.600% Notes due 2042", "$3,253,431,000,000", "14,776,353,000 shares",
   bare percentages, and mentions of other companies in the universe.

Each fact's text is wrapped in ``<span class="cs-fact" data-fact-id=...>`` so
the viewer can locate it with one DOM query. See docs/EDGAR_SPIDER.md.
"""

from __future__ import annotations

import re
import warnings
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, NavigableString, Tag, XMLParsedAsHTMLWarning

from ingestion.edgar.classify import (
    classify_concept,
    classify_context,
    classify_security_title,
    label_for_match,
)
from ingestion.edgar.universe import MentionMatcher, mention_regex

SEC_BASE = "https://www.sec.gov/"


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class ExtractedFact:
    fact_index: int
    dom_id: str
    category: str
    kind: str
    raw_text: str
    label: str
    value_numeric: float | None
    unit: str | None
    context: str
    section: str
    concept: str | None
    source: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExtractedLink:
    fact_index: int
    dom_id: str
    target_ticker: str
    mention_text: str


@dataclass
class ExtractionResult:
    annotated_html: str
    facts: list[ExtractedFact]
    links: list[ExtractedLink]
    title: str = ""
    company_name: str | None = None
    period_of_report: date | None = None
    fiscal_year: int | None = None
    counts: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Regex patterns for the untagged-text pass. Order is priority.
# ---------------------------------------------------------------------------

_MULTIPLIERS = {"thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}

_NOTES_RE = re.compile(
    r"(?P<rate>\d+(?:\.\d+)?)%\s+(?:Senior\s+|Fixed[- ]Rate\s+|Floating[- ]Rate\s+)?Notes?\s+due\s+(?P<year>\d{4})",
    re.IGNORECASE,
)
_MONEY_RE = re.compile(
    r"\$\s?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s*(?P<mult>trillion|billion|million|thousand))?\b",
    re.IGNORECASE,
)
_SHARES_RE = re.compile(
    r"(?P<num>\d{1,3}(?:,\d{3})+)\s+shares\b",
    re.IGNORECASE,
)
_PERCENT_RE = re.compile(r"(?<![\d.])(?P<num>\d{1,3}(?:\.\d+)?)\s?%")

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z“\"(])")
_WS_RE = re.compile(r"\s+")

_PART_RE = re.compile(r"^\s*PART\s+(I{1,3}|IV)\b\.?\s*$", re.IGNORECASE)
_ITEM_RE = re.compile(
    r"^\s*Item\s+(?P<num>\d{1,2}[A-C]?)\s*[.:—–-]?\s*(?P<rest>.{0,170})$", re.IGNORECASE
)

_INLINE_TAGS = {"span", "b", "i", "u", "em", "strong", "font", "a", "sup", "sub", "small"}
_SKIP_TEXT_ANCESTORS = {
    "script",
    "style",
    "title",
    "head",
    "a",
    "ix:header",
    "ix:hidden",
    "ix:resources",
}
_DROP_TAGS = ("script", "link", "meta", "iframe", "object", "embed", "noscript", "base")

_DATE_FORMATS = ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d", "%m/%d/%Y", "%d %B %Y")


def _parse_date(text: str) -> date | None:
    cleaned = _WS_RE.sub(" ", text).strip().replace("\xa0", " ")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _to_number(text: str) -> float | None:
    cleaned = text.replace(",", "").replace("\xa0", "").strip()
    if cleaned in {"", "-", "—", "–"}:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return None


def _collapse(text: str, limit: int = 300) -> str:
    text = _WS_RE.sub(" ", text.replace("\xa0", " ")).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _sentence_around(text: str, start: int, end: int) -> str:
    """The sentence of ``text`` containing [start, end)."""
    left = text.rfind(". ", 0, start)
    left = 0 if left < 0 else left + 2
    right_match = re.search(r"[.!?](?:\s|$)", text[end:])
    right = end + right_match.end() if right_match else len(text)
    return text[left:right]


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------


class FilingExtractor:
    """Stateless-per-call extractor. Create once, call ``extract`` per filing."""

    def __init__(self, max_facts: int = 5000):
        self.max_facts = max_facts

    # -- public ---------------------------------------------------------------

    def extract(
        self, html: str, *, ticker: str | None = None, source_url: str | None = None
    ) -> ExtractionResult:
        # iXBRL filings start with an XML prolog; we deliberately parse them as
        # HTML so the output stays browser-renderable, which bs4 warns about.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
            soup = BeautifulSoup(html, "lxml")
        self._sanitize(soup, source_url)

        title = soup.title.get_text(strip=True) if soup.title else ""
        contexts = self._parse_contexts(soup)
        meta = self._document_metadata(soup)

        body: Tag = soup.body or soup
        mention_re = mention_regex(exclude_ticker=ticker)

        facts: list[ExtractedFact] = []
        links: list[ExtractedLink] = []
        pending_wraps: list[tuple[Tag, ExtractedFact]] = []
        pending_splits: list[tuple[NavigableString, list[tuple[int, int, ExtractedFact]]]] = []

        section = "Cover"
        next_index = 0

        def new_id() -> tuple[int, str]:
            nonlocal next_index
            idx = next_index
            next_index += 1
            return idx, f"f-{idx:05d}"

        # Materialize the walk so later DOM mutation cannot disturb iteration.
        for node in list(body.descendants):
            if next_index >= self.max_facts:
                break

            if isinstance(node, Tag):
                section = self._maybe_update_section(node, section)
                if node.name in ("ix:nonfraction", "ix:nonnumeric") and not self._in_hidden(node):
                    fact = self._ixbrl_fact(node, contexts, section, new_id)
                    if fact is not None:
                        facts.append(fact)
                        pending_wraps.append((node, fact))
                continue

            if not isinstance(node, NavigableString) or type(node) is not NavigableString:
                continue  # comments, doctype, CData
            text = str(node)
            if not text.strip() or self._skip_text(node):
                continue

            matches = self._text_matches(text, mention_re)
            if not matches:
                continue
            per_node: list[tuple[int, int, ExtractedFact]] = []
            parent_text = self._enclosing_text(node)
            for start, end, kind, value, unit, label, target_ticker in matches:
                raw = text[start:end]
                sentence = _collapse(_sentence_around(parent_text, *self._locate(parent_text, raw)))
                idx, dom_id = new_id()
                if kind == "entity":
                    fact = ExtractedFact(
                        idx,
                        dom_id,
                        "other",
                        "entity",
                        raw,
                        f"Mentions {raw} ({target_ticker})",
                        None,
                        None,
                        sentence,
                        section,
                        None,
                        "entity",
                    )
                    links.append(ExtractedLink(idx, dom_id, target_ticker, raw))
                else:
                    category = classify_context(sentence, kind)
                    fact = ExtractedFact(
                        idx,
                        dom_id,
                        category,
                        kind,
                        raw,
                        label or label_for_match(sentence, raw),
                        value,
                        unit,
                        sentence,
                        section,
                        None,
                        "regex",
                    )
                facts.append(fact)
                per_node.append((start, end, fact))
            pending_splits.append((node, per_node))

        # Mutate the DOM only after the walk is complete.
        for tag, fact in pending_wraps:
            self._wrap_tag(soup, tag, fact)
        for node, per_node in pending_splits:
            self._split_text_node(soup, node, per_node)

        counts = {c: 0 for c in ("revenue", "debt", "shares", "other")}
        for f in facts:
            counts[f.category] += 1

        return ExtractionResult(
            annotated_html=str(soup),
            facts=facts,
            links=links,
            title=title,
            company_name=meta.get("company_name"),
            period_of_report=meta.get("period_of_report"),
            fiscal_year=meta.get("fiscal_year"),
            counts=counts,
        )

    # -- sanitization --------------------------------------------------------

    def _sanitize(self, soup: BeautifulSoup, source_url: str | None) -> None:
        for name in _DROP_TAGS:
            for el in soup.find_all(name):
                el.decompose()
        base = source_url or SEC_BASE
        for el in soup.find_all(True):
            for attr in list(el.attrs):
                if attr.lower().startswith("on"):
                    del el.attrs[attr]
            href = el.get("href")
            if isinstance(href, str):
                if href.strip().lower().startswith("javascript:"):
                    del el.attrs["href"]
                elif not href.startswith("#"):
                    el["href"] = urljoin(base, href)
                    el["target"] = "_blank"
                    el["rel"] = "noopener noreferrer"
            src = el.get("src")
            if isinstance(src, str) and not src.startswith(("data:", "http://", "https://")):
                el["src"] = urljoin(base, src)

    # -- iXBRL helpers -------------------------------------------------------

    def _parse_contexts(self, soup: BeautifulSoup) -> dict[str, str]:
        """context id -> human period string ('as of 2025-09-27' / 'FY ending 2025-09-27')."""
        out: dict[str, str] = {}
        for ctx in soup.find_all("xbrli:context"):
            cid = ctx.get("id")
            if not cid:
                continue
            instant = ctx.find("xbrli:instant")
            end = ctx.find("xbrli:enddate")
            if instant and instant.string:
                out[cid] = f"as of {instant.string.strip()}"
            elif end and end.string:
                out[cid] = f"period ending {end.string.strip()}"
        return out

    def _document_metadata(self, soup: BeautifulSoup) -> dict:
        meta: dict = {}
        name_tag = soup.find("ix:nonnumeric", attrs={"name": "dei:EntityRegistrantName"})
        if name_tag:
            meta["company_name"] = _collapse(name_tag.get_text(" ", strip=True), 120)
        period_tag = soup.find("ix:nonnumeric", attrs={"name": "dei:DocumentPeriodEndDate"})
        if period_tag:
            meta["period_of_report"] = _parse_date(period_tag.get_text(" ", strip=True))
        fy_tag = soup.find("ix:nonnumeric", attrs={"name": "dei:DocumentFiscalYearFocus"})
        if fy_tag:
            try:
                meta["fiscal_year"] = int(fy_tag.get_text(strip=True))
            except ValueError:
                pass
        if "fiscal_year" not in meta and meta.get("period_of_report"):
            meta["fiscal_year"] = meta["period_of_report"].year
        return meta

    @staticmethod
    def _in_hidden(tag: Tag) -> bool:
        for parent in tag.parents:
            if parent.name in ("ix:header", "ix:hidden", "ix:resources"):
                return True
            style = parent.get("style") if isinstance(parent, Tag) else None
            if isinstance(style, str) and "display:none" in style.replace(" ", "").lower():
                return True
        return False

    @staticmethod
    def _unit_from_ref(unit_ref: str | None, concept: str) -> str | None:
        if not unit_ref:
            return None
        u = unit_ref.lower()
        if "usd" in u:
            return "USD"
        if "share" in u:
            return "shares"
        if "pure" in u or "percent" in u:
            return "percent" if re.search(r"(Percentage|Rate)\b", concept) else None
        return None

    def _ixbrl_fact(
        self, tag: Tag, contexts: dict[str, str], section: str, new_id
    ) -> ExtractedFact | None:
        concept = tag.get("name")
        if not isinstance(concept, str) or not concept:
            return None
        raw = _collapse(tag.get_text(" ", strip=True), 200)
        if not raw:
            return None
        # Never wrap an ix tag that already sits inside another fact span
        # (nested ix tags do occur); the outer one wins.
        for parent in tag.parents:
            if isinstance(parent, Tag) and parent.name in ("ix:nonfraction", "ix:nonnumeric"):
                return None

        row_text = self._enclosing_text(tag)
        period = contexts.get(str(tag.get("contextref") or ""), "")
        context = _collapse(f"{row_text} ({period})" if period else row_text)

        if tag.name == "ix:nonnumeric":
            local = concept.split(":", 1)[-1]
            if local == "Security12bTitle":
                cls, value, unit = classify_security_title(raw)
                idx, dom_id = new_id()
                return ExtractedFact(
                    idx,
                    dom_id,
                    cls.category,
                    cls.kind,
                    raw,
                    cls.label,
                    value,
                    unit,
                    context,
                    section,
                    concept,
                    "ixbrl",
                )
            if local in ("TradingSymbol", "EntityRegistrantName", "DocumentPeriodEndDate"):
                cls = classify_concept(concept, None)
                idx, dom_id = new_id()
                return ExtractedFact(
                    idx,
                    dom_id,
                    cls.category,
                    cls.kind,
                    raw,
                    cls.label,
                    None,
                    None,
                    context,
                    section,
                    concept,
                    "ixbrl",
                )
            return None  # long text blocks (policies, notes) are not facts

        # ix:nonfraction
        unit = self._unit_from_ref(tag.get("unitref"), concept)
        cls = classify_concept(concept, unit)
        number = _to_number(raw)
        value: float | None = None
        if number is not None:
            scale = tag.get("scale")
            try:
                value = number * (10 ** int(scale)) if scale else number
            except ValueError:
                value = number
            if tag.get("sign") == "-":
                value = -value
            if cls.kind == "percent":
                # Interest rates are displayed as "3.600" with scale -2; keep the
                # displayed percentage (3.6), not the ratio (0.036).
                value = number
        idx, dom_id = new_id()
        unit_out = "percent" if cls.kind == "percent" else unit
        return ExtractedFact(
            idx,
            dom_id,
            cls.category,
            cls.kind,
            raw,
            cls.label,
            value,
            unit_out,
            context,
            section,
            concept,
            "ixbrl",
        )

    # -- section tracking ----------------------------------------------------

    def _maybe_update_section(self, tag: Tag, current: str) -> str:
        if tag.name in _INLINE_TAGS or tag.name in (
            "table",
            "tr",
            "tbody",
            "thead",
            "body",
            "html",
        ):
            return current
        if not tag.contents or len(tag.contents) > 12:
            return current
        text = self._short_text(tag, 180)
        if not text:
            return current
        if self._in_toc(tag):
            return current
        if _PART_RE.match(text):
            return "Part " + _PART_RE.match(text).group(1).upper()
        m = _ITEM_RE.match(text)
        if m:
            return f"Item {m.group('num').upper()}"
        return current

    @staticmethod
    def _short_text(tag: Tag, limit: int) -> str | None:
        """Collapsed text of ``tag`` if it is at most ``limit`` chars, else None.

        Stops reading as soon as the limit is exceeded, so a wrapper div around
        a multi-megabyte filing costs nothing instead of a full get_text().
        """
        parts: list[str] = []
        total = 0
        for piece in tag.stripped_strings:
            total += len(piece) + 1
            if total > limit:
                return None
            parts.append(piece)
        return " ".join(parts)

    @staticmethod
    def _in_toc(tag: Tag) -> bool:
        for parent in tag.parents:
            if not isinstance(parent, Tag):
                continue
            if parent.name == "a":
                return True
            if parent.name == "table":
                anchors = parent.find_all("a", href=re.compile(r"^#"), limit=6)
                return len(anchors) >= 5
        return False

    # -- text pass -----------------------------------------------------------

    @staticmethod
    def _skip_text(node: NavigableString) -> bool:
        for parent in node.parents:
            if parent.name in _SKIP_TEXT_ANCESTORS or (parent.name or "").startswith("ix:"):
                return True
            if (
                isinstance(parent, Tag)
                and parent.get("class")
                and "cs-fact" in parent.get("class", [])
            ):
                return True
        return False

    @staticmethod
    def _enclosing_text(node) -> str:
        """Text of the nearest row/paragraph-like ancestor, for context.

        A table cell alone ("$ 209,586") says nothing, so cells defer to their
        row; a layout div wrapping the whole document is skipped in favor of
        the nearest reasonably sized block.
        """
        fallback = ""
        for parent in node.parents:
            if parent.name in ("tr", "p", "li"):
                return parent.get_text(" ", strip=True)
            if parent.name in ("td", "th", "div", "body") and not fallback:
                text = parent.get_text(" ", strip=True)
                if parent.name in ("td", "th"):
                    continue  # keep looking for the row
                if len(text) <= 600:
                    fallback = text
        return fallback or str(node)

    @staticmethod
    def _locate(parent_text: str, raw: str) -> tuple[int, int]:
        """Position of this match inside the enclosing text (whole text if absent)."""
        pos = parent_text.find(raw)
        if pos < 0:
            return 0, len(parent_text)
        return pos, pos + len(raw)

    def _text_matches(self, text: str, mention_re: MentionMatcher):
        """Non-overlapping matches as (start, end, kind, value, unit, label, ticker)."""
        found: list[tuple[int, int, str, float | None, str | None, str | None, str | None]] = []
        taken: list[tuple[int, int]] = []

        def free(s: int, e: int) -> bool:
            return all(e <= ts or s >= te for ts, te in taken)

        for m in _NOTES_RE.finditer(text):
            if free(*m.span()):
                taken.append(m.span())
                found.append(
                    (
                        m.start(),
                        m.end(),
                        "percent",
                        float(m.group("rate")),
                        "percent",
                        f"Notes due {m.group('year')}",
                        None,
                    )
                )
        for m in _MONEY_RE.finditer(text):
            if not free(*m.span()):
                continue
            value = _to_number(m.group("num"))
            if value is None:
                continue
            mult = m.group("mult")
            if mult:
                value *= _MULTIPLIERS[mult.lower()]
            elif value < 1000 and "," not in m.group("num"):
                continue  # "$5 per share" style noise
            taken.append(m.span())
            found.append((m.start(), m.end(), "money", value, "USD", None, None))
        for m in _SHARES_RE.finditer(text):
            if free(*m.span()):
                taken.append(m.span())
                found.append(
                    (m.start(), m.end(), "shares", _to_number(m.group("num")), "shares", None, None)
                )
        for m in _PERCENT_RE.finditer(text):
            if free(*m.span()):
                taken.append(m.span())
                found.append(
                    (
                        m.start(),
                        m.end(),
                        "percent",
                        _to_number(m.group("num")),
                        "percent",
                        None,
                        None,
                    )
                )
        for m in mention_re.finditer(text):
            if free(*m.span()):
                taken.append(m.span())
                found.append(
                    (m.start(), m.end(), "entity", None, None, None, mention_re.ticker_for(m))
                )

        found.sort(key=lambda t: t[0])
        return found

    # -- DOM mutation --------------------------------------------------------

    @staticmethod
    def _fact_span(soup: BeautifulSoup, fact: ExtractedFact) -> Tag:
        span = soup.new_tag("span")
        span["class"] = "cs-fact"
        span["id"] = fact.dom_id
        span["data-fact-id"] = fact.dom_id
        span["data-category"] = fact.category
        span["data-kind"] = fact.kind
        return span

    def _wrap_tag(self, soup: BeautifulSoup, tag: Tag, fact: ExtractedFact) -> None:
        tag.wrap(self._fact_span(soup, fact))

    def _split_text_node(
        self,
        soup: BeautifulSoup,
        node: NavigableString,
        matches: list[tuple[int, int, ExtractedFact]],
    ) -> None:
        if node.parent is None:
            return
        text = str(node)
        pieces: list = []
        cursor = 0
        for start, end, fact in matches:
            if start > cursor:
                pieces.append(NavigableString(text[cursor:start]))
            span = self._fact_span(soup, fact)
            span.string = text[start:end]
            pieces.append(span)
            cursor = end
        if cursor < len(text):
            pieces.append(NavigableString(text[cursor:]))
        node.replace_with(*pieces)


def extract_filing(
    html: str, *, ticker: str | None = None, source_url: str | None = None
) -> ExtractionResult:
    """Convenience wrapper around :class:`FilingExtractor`."""
    return FilingExtractor().extract(html, ticker=ticker, source_url=source_url)
