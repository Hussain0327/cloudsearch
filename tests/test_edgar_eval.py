"""Offline tests for the EDGAR extraction eval harness (iXBRL pass)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from bs4 import BeautifulSoup
from click.testing import CliRunner

from ingestion.cli import cli
from ingestion.edgar.client import companyfacts_url
from ingestion.edgar.evaluation import runner
from ingestion.edgar.evaluation.groundtruth import flatten, slim
from ingestion.edgar.evaluation.match import classify_value, unit_matches
from ingestion.edgar.evaluation.runner import evaluate
from ingestion.edgar.ixbrl import observations, parse_contexts, parse_units

FIXTURES = Path(__file__).parent / "fixtures" / "edgar"
HTML_PATH = FIXTURES / "aapl_eps_dims.htm"
FACTS_PATH = FIXTURES / "companyfacts_aapl_sample.json"
ACCN = "0000320193-25-000079"


@pytest.fixture(scope="module")
def html() -> str:
    return HTML_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def payload() -> dict:
    return json.loads(FACTS_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def report(html, payload):
    return evaluate(html, flatten(payload, ACCN), max_facts=5000)


def _by_ix_id(report, ix_id):
    return next(s for s in report.scored if s.obs.ix_id == ix_id)


def _soup(markup: str) -> BeautifulSoup:
    return BeautifulSoup(markup, "lxml")


# --- client ---------------------------------------------------------------


def test_companyfacts_url_pads_cik():
    assert companyfacts_url("320193") == (
        "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
    )


# --- shared iXBRL parser ----------------------------------------------------


def test_units_resolve_divide_to_ratio(html):
    units = parse_units(_soup(html))
    assert units["usdPerShare"] == "USD/shares"
    assert units["usd"] == "USD"
    assert units["shares"] == "shares"
    assert units["number"] == "pure"


def test_contexts_carry_period_and_dimensionality(html):
    ctxs = parse_contexts(_soup(html))
    assert (ctxs["c-1"].start, ctxs["c-1"].end, ctxs["c-1"].instant) == (
        "2024-09-29",
        "2025-09-27",
        False,
    )
    assert (ctxs["c-6"].start, ctxs["c-6"].end, ctxs["c-6"].instant) == (
        None,
        "2025-09-27",
        True,
    )
    assert ctxs["c-7"].dimensional and not ctxs["c-1"].dimensional


def test_observations_cover_every_nonfraction_with_scale_sign_zero_inf(html):
    soup = _soup(html)
    obs = {o.ix_id: o for o in observations(soup)}
    assert len(obs) == len(soup.find_all("ix:nonfraction"))
    assert obs["f-rev-tot-25"].value == 415_644_000_000
    assert obs["x-sign"].value == -1_234_000_000
    assert obs["x-zero"].value == 0
    assert math.isinf(obs["x-inf"].decimals)
    assert obs["f-rate-min"].scale == -2 and obs["f-rate-min"].dom_id is None


def test_observations_flag_hidden_nested_and_wrapped():
    soup = _soup(
        '<body><div style="display:none"><ix:nonfraction name="a:B" id="h">1</ix:nonfraction>'
        '</div><ix:nonfraction name="a:B" id="outer">2<ix:nonfraction name="a:B" id="inner">'
        "3</ix:nonfraction></ix:nonfraction>"
        '<span class="cs-fact" data-fact-id="f-00007">'
        '<ix:nonfraction name="a:B" id="w">4</ix:nonfraction></span></body>'
    )
    obs = {o.ix_id: o for o in observations(soup)}
    assert obs["h"].hidden and not obs["outer"].hidden
    assert obs["inner"].nested and not obs["outer"].nested
    assert obs["w"].dom_id == "f-00007" and obs["outer"].dom_id is None


# --- ground truth -----------------------------------------------------------


def test_flatten_drops_rows_from_other_accessions(payload):
    truth = flatten(payload, ACCN)
    key = ("us-gaap:NetIncomeLoss", "USD", "2024-09-29", "2025-09-27")
    assert truth[key] == [112_010_000_000]  # the accn ...-24-000123 row (val 1) is gone
    assert flatten(payload, "0000000000-00-000000") == {}


def test_slim_keeps_only_requested_accession(payload):
    rows = slim(payload, ACCN)["facts"]["us-gaap"]["NetIncomeLoss"]["units"]["USD"]
    assert {r["accn"] for r in rows} == {ACCN}


# --- match rules ------------------------------------------------------------


def test_classify_exact_rounded_mismatch():
    assert classify_value(100.0, 0, [100.0], False) == ("exact", ())
    assert classify_value(98.2e9, -8, [98.157e9], False) == ("rounded", ())
    assert classify_value(98.2e9, -6, [98.157e9], False)[0] == "value_mismatch"


def test_decimals_inf_means_exact_only():
    assert classify_value(10.0, math.inf, [10.4], False)[0] == "value_mismatch"
    assert classify_value(10.0, math.inf, [10.0], False)[0] == "exact"


def test_percent_convention_accepted_and_flagged_only_for_pure():
    assert classify_value(3.6, 3.0, [0.036], True) == ("exact", ("percent_convention",))
    assert classify_value(3.6, 3.0, [0.036], False)[0] == "value_mismatch"


def test_unit_matches():
    assert unit_matches("USD", "USD")
    assert not unit_matches("USD", "USD/shares")
    assert unit_matches("percent", "pure") and unit_matches(None, "pure")


# --- end to end over the fixtures ------------------------------------------


def test_dimensional_fact_is_unverifiable(report):
    s = _by_ix_id(report, "x-ni-dim")
    assert (s.klass, s.reason) == ("unverifiable", "dimensional")


def test_wrong_fixture_value_is_value_mismatch(report):
    assert _by_ix_id(report, "f-ni-24").klass == "value_mismatch"
    assert _by_ix_id(report, "f-ni-25").klass == "exact"


def test_missing_truth_key_is_unverifiable_not_error(report):
    s = _by_ix_id(report, "f-cp")
    assert (s.klass, s.reason) == ("unverifiable", "no_truth_key")


def test_rounded_scale_sign_and_fixed_zero(report):
    assert _by_ix_id(report, "f-ltd").klass == "rounded"
    assert _by_ix_id(report, "x-sign").klass == "exact"
    assert _by_ix_id(report, "x-zero").klass == "exact"
    assert _by_ix_id(report, "x-inf").klass == "exact"
    assert _by_ix_id(report, "f-wsh-25").klass == "exact"


def test_eps_unit_resolves_to_ratio_and_stored_usd_is_flagged(report):
    s = _by_ix_id(report, "x-eps-basic")
    assert s.measure == "USD/shares" and s.stored_unit == "USD"
    assert s.klass == "exact" and "unit_mismatch" in s.flags


def test_percent_fact_accepted_and_flagged(report):
    s = _by_ix_id(report, "x-pct")
    assert s.klass == "exact" and "percent_convention" in s.flags


def test_metrics(report):
    m = report.summary()
    assert m["recall"] == 1.0  # every verifiable tag is visible and wrapped
    assert 0 < m["parse_fidelity"] < 1  # f-ni-24 is the deliberate mismatch
    assert m["unit_accuracy"] < 1  # EPS stored as USD
    assert 0 < m["verifiable_fraction"] < 1
    assert m["per_concept"]["us-gaap:NetIncomeLoss"]["value_mismatch"] == 1
    assert m["per_concept"]["us-gaap:NetIncomeLoss"]["unverifiable"] == 1


def test_truncation_reported(html, payload):
    capped = evaluate(html, flatten(payload, ACCN), max_facts=5).summary()["truncation"]
    assert capped["truncated"] and capped["max_facts"] == 5
    assert capped["extracted"] < capped["ix_tags"]
    full = evaluate(html, flatten(payload, ACCN), max_facts=5000).summary()["truncation"]
    assert not full["truncated"]


def test_unparsed_extracted_value_is_value_mismatch(html, payload, monkeypatch):
    real = runner.FilingExtractor.extract

    def extract(self, *args, **kwargs):
        result = real(self, *args, **kwargs)
        for f in result.facts:
            f.value_numeric = None
        return result

    monkeypatch.setattr(runner.FilingExtractor, "extract", extract)
    rep = evaluate(html, flatten(payload, ACCN))
    assert any("unparsed" in s.flags and s.klass == "value_mismatch" for s in rep.scored)


def test_non_extracted_tags_are_missed_not_scored_and_capped_bucketed(html, payload):
    rep = evaluate(html, flatten(payload, ACCN), max_facts=5)
    assert rep.missed["capped"] > 0
    cols = rep.summary()["per_concept"]
    assert sum(c["missed"] for c in cols.values()) > 0
    scored = sum(c[k] for c in cols.values() for k in ("exact", "rounded", "value_mismatch"))
    assert scored == sum(s.extracted and s.klass != "unverifiable" for s in rep.scored)


def test_empty_nonfraction_is_not_zero():
    obs = observations(
        _soup('<ix:nonfraction name="a:B" contextref="c" unitref="u"></ix:nonfraction>')
    )
    assert obs[0].value is None


# --- CLI --------------------------------------------------------------------


def _eval_args(*extra: str) -> list[str]:
    return [
        "edgar",
        "eval",
        "--file",
        str(HTML_PATH),
        "--accession",
        ACCN,
        "--cik",
        "320193",
        "--companyfacts",
        str(FACTS_PATH),
        *extra,
    ]


def test_cli_prints_per_concept_table_and_exits_zero():
    result = CliRunner().invoke(cli, _eval_args())
    assert result.exit_code == 0, result.output
    assert "us-gaap:NetIncomeLoss" in result.output
    assert "value_mismatch" in result.output
    assert "parse fidelity vs SEC companyfacts" in result.output
    assert "accuracy" not in result.output.replace("unit accuracy", "")
    assert "verifiable fraction" in result.output and "max_facts" in result.output


def test_cli_fail_under_recall_exits_one():
    assert CliRunner().invoke(cli, _eval_args("--fail-under-recall", "1.0")).exit_code == 0
    assert CliRunner().invoke(cli, _eval_args("--fail-under-recall", "1.01")).exit_code == 1


def test_cli_offline_mode_requires_accession_and_companyfacts():
    result = CliRunner().invoke(cli, ["edgar", "eval", "--file", str(HTML_PATH)])
    assert result.exit_code != 0
