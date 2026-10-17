"""Tests for the EDGAR extractor, classifier and annotated-HTML markup."""

from __future__ import annotations

import re
from importlib import resources

import pytest
from bs4 import BeautifulSoup

from ingestion.edgar.classify import (
    classify_concept,
    classify_context,
    classify_security_title,
    humanize_concept,
    label_for_match,
)
from ingestion.edgar.extract import ExtractionResult, FilingExtractor, extract_filing
from ingestion.edgar.universe import mention_regex


@pytest.fixture(scope="module")
def aapl_html() -> str:
    return (
        resources.files("ingestion.edgar.demo")
        .joinpath("aapl_10k_sample.htm")
        .read_text(encoding="utf-8")
    )


@pytest.fixture(scope="module")
def aapl(aapl_html) -> ExtractionResult:
    return extract_filing(
        aapl_html,
        ticker="AAPL",
        source_url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    )


# --- classifier ---------------------------------------------------------------


class TestClassifier:
    def test_revenue_concepts(self):
        c = classify_concept("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "USD")
        assert (c.category, c.kind, c.label) == ("revenue", "money", "Net sales")

    def test_debt_rate_is_percent(self):
        c = classify_concept("us-gaap:DebtInstrumentInterestRateStatedPercentage", "percent")
        assert (c.category, c.kind) == ("debt", "percent")

    def test_shares_by_unit_fallback(self):
        c = classify_concept("us-gaap:SomeObscureSharesConcept", "shares")
        assert c.category == "shares"
        assert c.label == "Some obscure shares concept"

    def test_unknown_money_concept_is_other(self):
        c = classify_concept("us-gaap:AccountsPayableCurrent", "USD")
        assert (c.category, c.kind, c.label) == ("other", "money", "Accounts payable current")

    def test_humanize(self):
        assert humanize_concept("LongTermDebtNoncurrent") == "Long term debt noncurrent"
        assert humanize_concept("EntityPublicFloat") == "Entity public float"

    def test_security_title_notes(self):
        c, value, unit = classify_security_title("3.600% Notes due 2042")
        assert (c.category, c.kind, c.label, value, unit) == (
            "debt",
            "percent",
            "Notes due 2042",
            3.6,
            "percent",
        )

    def test_security_title_common_stock(self):
        c, value, _unit = classify_security_title("Common Stock, $0.00001 par value per share")
        assert (c.category, c.kind) == ("shares", "text")
        assert value is None

    def test_context_classification(self):
        assert classify_context("the Company issued $4.5 billion of new Notes", "money") == "debt"
        assert classify_context("Total net sales increased 6%", "percent") == "revenue"
        assert classify_context("14,776,353,000 shares outstanding", "shares") == "shares"
        assert classify_context("there were 23,100 employees", "money") == "other"

    def test_label_for_match_prefers_leading_clause(self):
        assert (
            label_for_match("Total net sales increased 6% or $24.6 billion during 2025.", "6%")
            == "Total net sales increased"
        )

    def test_label_for_match_drops_weak_tail(self):
        sentence = "The aggregate market value of the voting stock held by non-affiliates was approximately $3,253,431,000,000."
        label = label_for_match(sentence, "$3,253,431,000,000")
        assert label.endswith("non-affiliates")

    def test_label_for_match_strips_year_prefix(self):
        assert (
            label_for_match("In 2025, iPhone represented 51% of total net sales.", "51%")
            == "iPhone represented"
        )


# --- universe mentions -------------------------------------------------------


class TestMentions:
    def test_excludes_self_and_is_word_bounded(self):
        m = mention_regex(exclude_ticker="AAPL")
        text = "Apple competes with Microsoft; Applewood and Microsofty are not companies."
        found = [(x.group(0), m.ticker_for(x)) for x in m.finditer(text)]
        assert found == [("Microsoft", "MSFT")]

    def test_longest_alias_wins(self):
        m = mention_regex()
        x = next(m.finditer("Alphabet Inc. reported"))
        assert x.group(0) == "Alphabet Inc."
        assert m.ticker_for(x) == "GOOGL"


# --- end to end on the Apple sample ------------------------------------------


class TestAppleSample:
    def test_metadata(self, aapl):
        assert aapl.company_name == "Apple Inc."
        assert str(aapl.period_of_report) == "2025-09-27"
        assert aapl.fiscal_year == 2025

    def test_cover_page_facts(self, aapl):
        by_raw = {f.raw_text: f for f in aapl.facts}
        notes = by_raw["3.600% Notes due 2042"]
        assert (notes.category, notes.kind, notes.value_numeric, notes.unit) == (
            "debt",
            "percent",
            3.6,
            "percent",
        )
        assert notes.label == "Notes due 2042"
        assert notes.section == "Cover"
        assert notes.source == "ixbrl"
        assert notes.concept == "dei:Security12bTitle"

        public_float = by_raw["3,253,431,000,000"]
        assert public_float.value_numeric == 3_253_431_000_000
        assert public_float.unit == "USD"
        assert public_float.category == "other"

        shares = by_raw["14,776,353,000"]
        assert (shares.category, shares.value_numeric) == ("shares", 14_776_353_000)

    def test_ixbrl_scale_applied(self, aapl):
        total = next(f for f in aapl.facts if f.raw_text == "415,644")
        assert total.value_numeric == 415_644_000_000
        assert total.category == "revenue"
        assert "period ending 2025-09-27" in total.context
        assert total.context.startswith("Total net sales")  # row text, not cell text

    def test_interest_rate_keeps_displayed_percentage(self, aapl):
        rate = next(
            f
            for f in aapl.facts
            if f.concept == "us-gaap:DebtInstrumentInterestRateStatedPercentage"
            and f.raw_text == "4.850"
        )
        assert rate.value_numeric == 4.85
        assert rate.unit == "percent"

    def test_regex_pass_finds_untagged_figures(self, aapl):
        regex_facts = {f.raw_text: f for f in aapl.facts if f.source == "regex"}
        assert regex_facts["$24.6 billion"].value_numeric == 24_600_000_000
        assert regex_facts["$24.6 billion"].category == "revenue"
        assert regex_facts["4.750% Notes due 2035"].category == "debt"
        assert regex_facts["4.750% Notes due 2035"].label == "Notes due 2035"
        assert regex_facts["51%"].category == "revenue"

    def test_sections_follow_item_headings_not_toc(self, aapl):
        sections = {f.section for f in aapl.facts}
        assert {"Cover", "Item 1", "Item 1A", "Item 5", "Item 7", "Item 8"} <= sections
        # Facts on the cover must not be attributed to a TOC "Item 1." link.
        assert all(
            f.section == "Cover" for f in aapl.facts if f.raw_text.endswith("Notes due 2042")
        )

    def test_company_mentions_become_links(self, aapl):
        tickers = {l.target_ticker for l in aapl.links}
        assert tickers == {"MSFT", "GOOGL", "AMZN", "NVDA"}
        link = aapl.links[0]
        fact = aapl.facts[link.fact_index]
        assert fact.kind == "entity" and fact.dom_id == link.dom_id and fact.source == "entity"
        # The filer's own name is never a link.
        assert not any(l.target_ticker == "AAPL" for l in aapl.links)

    def test_fact_indices_are_dense_and_in_document_order(self, aapl):
        assert [f.fact_index for f in aapl.facts] == list(range(len(aapl.facts)))
        assert all(f.dom_id == f"f-{f.fact_index:05d}" for f in aapl.facts)
        # Document order: cover facts precede Item 7 facts.
        first_item7 = next(f.fact_index for f in aapl.facts if f.section == "Item 7")
        assert all(f.fact_index < first_item7 for f in aapl.facts if f.section == "Cover")

    def test_counts_match(self, aapl):
        assert sum(aapl.counts.values()) == len(aapl.facts)
        assert set(aapl.counts) == {"revenue", "debt", "shares", "other"}

    def test_annotated_html_markup(self, aapl):
        soup = BeautifulSoup(aapl.annotated_html, "lxml")
        spans = soup.select("span.cs-fact[data-fact-id]")
        assert len(spans) == len(aapl.facts)
        ids = [s["data-fact-id"] for s in spans]
        assert ids == [f.dom_id for f in aapl.facts]  # same document order
        for span, fact in zip(spans, aapl.facts):
            assert span["id"] == fact.dom_id
            assert span["data-category"] == fact.category
            assert span["data-kind"] == fact.kind
            assert (
                span.get_text(" ", strip=True).replace("\xa0", " ").split() == fact.raw_text.split()
            )
            # No nesting.
            assert not span.select("span.cs-fact")

    def test_sanitization(self, aapl):
        assert "alert(" not in aapl.annotated_html
        assert "<script" not in aapl.annotated_html.lower()
        soup = BeautifulSoup(aapl.annotated_html, "lxml")
        # In-document anchors are kept relative; nothing points at javascript:.
        assert all(not (a.get("href") or "").startswith("javascript:") for a in soup.find_all("a"))
        assert soup.find("a", href="#item1") is not None

    def test_hidden_ixbrl_header_is_not_annotated(self, aapl):
        assert not any(f.concept == "dei:AmendmentFlag" for f in aapl.facts)
        assert not any(f.concept == "dei:EntityCentralIndexKey" for f in aapl.facts)


class TestEdgeCases:
    def test_plain_html_without_ixbrl(self):
        html = """<html><body><p>Net sales were $391.0 billion, up 2%.</p>
        <p>We issued 3.250% Notes due 2033 and repurchased 95,000,000 shares.</p></body></html>"""
        r = extract_filing(html)
        kinds = [(f.raw_text, f.category, f.kind) for f in r.facts]
        assert ("$391.0 billion", "revenue", "money") in kinds
        assert ("2%", "revenue", "percent") in kinds
        assert ("3.250% Notes due 2033", "debt", "percent") in kinds
        assert ("95,000,000 shares", "shares", "shares") in kinds
        assert r.company_name is None

    def test_small_dollar_amounts_ignored_as_noise(self):
        r = extract_filing(
            "<html><body><p>Dividends of $0.26 per share and a $5 fee.</p></body></html>"
        )
        assert not any(f.kind == "money" for f in r.facts)

    def test_max_facts_cap(self):
        html = (
            "<html><body>"
            + "".join(f"<p>Revenue was ${i:,} million.</p>" for i in range(1000, 1200))
            + "</body></html>"
        )
        r = FilingExtractor(max_facts=25).extract(html)
        assert len(r.facts) <= 25

    def test_relative_links_absolutized(self):
        html = '<html><body><a href="ex10.htm">Exhibit</a><img src="img/logo.jpg"/></body></html>'
        r = extract_filing(
            html, source_url="https://www.sec.gov/Archives/edgar/data/1/0001/doc.htm"
        )
        assert 'href="https://www.sec.gov/Archives/edgar/data/1/0001/ex10.htm"' in r.annotated_html
        assert (
            'src="https://www.sec.gov/Archives/edgar/data/1/0001/img/logo.jpg"' in r.annotated_html
        )

    def test_on_attributes_removed(self):
        r = extract_filing(
            '<html><body><div onclick="x()">$1,000 million of notes</div></body></html>'
        )
        assert "onclick" not in r.annotated_html
        assert re.search(r'data-fact-id="f-00000"', r.annotated_html)
