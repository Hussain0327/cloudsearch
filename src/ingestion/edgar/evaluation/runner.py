"""Run the extractor on one filing and score every iXBRL tag against truth."""

from __future__ import annotations

import warnings
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from ingestion.edgar.evaluation.groundtruth import Truth, fetch_truth
from ingestion.edgar.evaluation.match import UNVERIFIABLE, classify_value, unit_matches
from ingestion.edgar.extract import FilingExtractor
from ingestion.edgar.ixbrl import IxObservation, observations, parse_contexts, parse_units

SCORED_CLASSES = ("exact", "rounded", "value_mismatch")
CLASSES = (*SCORED_CLASSES, UNVERIFIABLE)
COLUMNS = (*CLASSES, "missed")


@dataclass
class Scored:
    obs: IxObservation
    klass: str
    reason: str | None = None  # why unverifiable
    flags: tuple[str, ...] = ()
    measure: str | None = None
    stored_unit: str | None = None
    extracted: bool = False


@dataclass
class Report:
    scored: list[Scored]
    ix_tags: int
    extracted_ix: int
    max_facts: int
    truncated: bool
    missed: Counter = field(default_factory=Counter)

    def summary(self) -> dict:
        verifiable = [s for s in self.scored if s.klass != UNVERIFIABLE]
        hit = [s for s in verifiable if s.extracted]
        per_concept: dict[str, Counter] = {}
        for s in self.scored:
            # Score extractor output only; verifiable tags it never produced are "missed".
            col = s.klass if s.extracted or s.klass == UNVERIFIABLE else "missed"
            per_concept.setdefault(s.obs.name, Counter())[col] += 1

        def ratio(num: int, den: int) -> float | None:
            return num / den if den else None

        return {
            "observations": len(self.scored),
            "recall": ratio(len(hit), len(verifiable)),
            "parse_fidelity": ratio(sum(s.klass != "value_mismatch" for s in hit), len(hit)),
            "unit_accuracy": ratio(sum("unit_mismatch" not in s.flags for s in hit), len(hit)),
            "verifiable_fraction": ratio(len(verifiable), len(self.scored)),
            "per_concept": per_concept,
            "flags": Counter(f for s in self.scored for f in s.flags),
            "missed": dict(self.missed),
            "truncation": {
                "ix_tags": self.ix_tags,
                "extracted": self.extracted_ix,
                "max_facts": self.max_facts,
                "truncated": self.truncated,
            },
        }


def evaluate(
    html: str, truth: Truth, *, ticker: str | None = None, max_facts: int = 5000
) -> Report:
    """Extracts ``html`` and scores every ix:nonfraction tag against ``truth``.

    Args:
        html: The filing's inline-XBRL document.
        truth: Flattened companyfacts rows for the filing's accession.
        ticker: Optional ticker passed through to the extractor.
        max_facts: The extractor's fact cap.

    Returns:
        A Report with one Scored entry per tag.
    """
    result = FilingExtractor(max_facts=max_facts).extract(html, ticker=ticker)
    truncated = len(result.facts) >= max_facts
    stored = {f.dom_id: f for f in result.facts}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(result.annotated_html, "lxml")
    contexts, units = parse_contexts(soup), parse_units(soup)

    scored: list[Scored] = []
    missed: Counter = Counter()
    for obs in observations(soup):
        fact = stored.get(obs.dom_id) if obs.dom_id else None
        measure = units.get(obs.unitref or "")
        s = Scored(
            obs,
            UNVERIFIABLE,
            measure=measure,
            stored_unit=fact.unit if fact else None,
            extracted=fact is not None,
        )
        scored.append(s)
        if fact is None:
            other = "capped" if truncated else "other"
            missed["hidden" if obs.hidden else "nested" if obs.nested else other] += 1
        ctx = contexts.get(obs.contextref or "")
        unparsed = fact is not None and fact.value_numeric is None and obs.value is not None
        value = obs.value if unparsed or fact is None else fact.value_numeric
        if ctx is None:
            s.reason = "no_context"
        elif ctx.dimensional:
            s.reason = "dimensional"  # companyfacts only carries non-dimensional facts
        elif measure is None:
            s.reason = "no_unit"
        elif value is None:
            s.reason = "no_value"
        elif not (truths := truth.get((obs.name, measure, ctx.start, ctx.end))):
            s.reason = "no_truth_key"
        else:
            s.klass, s.flags = classify_value(value, obs.decimals, truths, measure == "pure")
            if unparsed:  # extractor failed to parse a number the harness could read
                s.klass, s.flags = "value_mismatch", (*s.flags, "unparsed")
            if fact and not unit_matches(fact.unit, measure):
                s.flags += ("unit_mismatch",)
    extracted_ix = sum(f.source == "ixbrl" for f in result.facts)
    return Report(
        scored,
        len(soup.find_all(["ix:nonfraction", "ix:nonnumeric"])),
        extracted_ix,
        max_facts,
        truncated,
        missed,
    )


def format_report(label: str, report: Report) -> str:
    """Renders a Report as the plain-text per-concept table plus summary metrics."""
    m = report.summary()

    def pct(x: float | None) -> str:
        return "n/a" if x is None else f"{x:.3f}"

    t = m["truncation"]
    lines = [f"== {label} ==", f"{'concept':70s} " + " ".join(f"{c:>14s}" for c in COLUMNS)]
    for concept, counts in sorted(m["per_concept"].items()):
        lines.append(f"{concept[:70]:70s} " + " ".join(f"{counts[c]:14d}" for c in COLUMNS))
    lines += [
        f"recall (per verifiable ix tag, not per truth key): {pct(m['recall'])}",
        f"parse fidelity vs SEC companyfacts: {pct(m['parse_fidelity'])}",
        f"unit accuracy: {pct(m['unit_accuracy'])}",
        f"verifiable fraction: {pct(m['verifiable_fraction'])} of {m['observations']} tags",
        f"flags: {dict(m['flags'])}  missed tags: {m['missed']}",
        f"truncation: ix tags {t['ix_tags']}, extracted {t['extracted']}, max_facts "
        + f"{t['max_facts']} ({'TRUNCATED' if t['truncated'] else 'not truncated'})",
    ]
    return "\n".join(lines)


async def run_live(
    tickers: list[str], form: str, user_agent: str | None, max_facts: int
) -> list[tuple[str, Report]]:
    """Live path (untested offline): one ticker at a time to bound memory."""
    from ingestion.edgar.client import EdgarClient

    out: list[tuple[str, Report]] = []
    async with EdgarClient(user_agent=user_agent) as client:
        for ticker in tickers:
            filing = await client.latest_filing(ticker, form=form)
            truth = await fetch_truth(
                client, filing.cik, filing.ref.accession_number, Path(".cache/edgar")
            )
            report = evaluate(filing.html, truth, ticker=ticker, max_facts=max_facts)
            out.append((f"{ticker} {filing.ref.accession_number}", report))
    return out
