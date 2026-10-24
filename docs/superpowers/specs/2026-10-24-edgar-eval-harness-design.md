# EDGAR extraction eval harness: design

Date: 2026-10-24.
Status: draft, awaiting approval.
Roadmap: [2026-10-24-hacker-roadmap-design.md](2026-10-24-hacker-roadmap-design.md).

## Intent

Find out how well the extractor works on real 10-K filings, and publish
honest numbers.
Nothing has run the extractor on a real filing yet.
The harness shows where the regex pass breaks and becomes the gate for
every later extraction change.

## Goals

- `python -m ingestion edgar eval` re-extracts a filing and joins its
  iXBRL facts to SEC companyfacts ground truth by accession number.
- It reports, per concept and overall: recall, parse fidelity, value
  accuracy, unit accuracy, the verifiable fraction, and truncation status
  (ix tag count vs extracted facts vs `max_facts`).
- Second slice: a regex-only ablation that unwraps the ix tags and
  measures how many tagged values the regex pass re-finds, split into
  table cells and prose.
- Outputs: `report.json` (versioned schema), `report.md`, and
  `failures.jsonl`.

## Non-goals

- No change to extraction behavior or the facts schema.
  No alembic 003 and no Go or web changes.
- No fixing of what the eval finds.
  Fixes are separate changes that cite the eval numbers.
- No scoring of dimensional facts, entity mentions or extension
  concepts.
  They count as unverifiable and are reported separately.
- No Postgres requirement and no new dependencies.

## Anti-goals

- Calling iXBRL precision "accuracy".
  companyfacts is derived from the same iXBRL the extractor reads, so this
  measures parse fidelity (numbers, scale, sign, units), not independent
  correctness.
  The report labels it that way.
- Headline numbers without the verifiable fraction next to them.

## Ground truth

The primary source is
`https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json`, filtered to
rows whose `accn` equals the filing's accession.
The frames API was the original ask, but frames entries have no `form`,
`fy` or `start` fields and are cross-company, so joining one filing
against it is unreliable.
A small `--frames-check` samples about 20 (concept, period) pairs through
frames as a cross-check.
**This swap needs the user's OK.**

The companyfacts per-entry fields (`start`, `end`, `val`, `accn`, `fy`,
`fp`, `form`, `filed`, `frame`) were not live-verified because the fetch
was truncated.
The first build step confirms them with one real call.

## Match rules (iXBRL pass)

The join key is (taxonomy, tag, unit measure, period) within the
accession.
The period is `end` for an instant, else (`start`, `end`).
The expected value is the displayed number times `10**scale`, negated
for `sign="-"`, with `ixt:fixed-zero` and dashes mapping to 0.

| Class | Rule |
| ----- | ---- |
| `exact` | Within `1e-9 * max(1, abs(val))`. |
| `rounded` | Within `0.5 * 10**(-decimals)`; `decimals="INF"` means exact only. |
| `value_mismatch` | Key found, value differs. |
| `no_truth_key` | Key absent from truth; unverifiable, not an error. |

Percent facts are stored as displayed (3.6, not 0.036).
Stored value equal to truth times 100 is accepted and flagged as the
convention.
Units are scored against the resolved measure, which should surface the
known bug where EPS (`USD/shares`) is stored as `USD`.

The observe step reads every `ix:nonfraction` in the document, wrapped
or not.
Tags past the `max_facts` cap, hidden tags and nested tags are never
wrapped, so joining only through `data-fact-id` would drop the
denominators for the capped and dropped buckets.

## Layout

| Path | Kind | Purpose |
| ---- | ---- | ------- |
| `src/ingestion/edgar/client.py` | modify | `companyfacts_url(cik)` and `EdgarClient.companyfacts(cik)` through `get_json`. |
| `src/ingestion/edgar/ixbrl.py` | new | Shared pure parser: contexts, units, observations. |
| `src/ingestion/edgar/evaluation/groundtruth.py` | new | Flatten companyfacts, filter by accession, cache slim JSON. |
| `src/ingestion/edgar/evaluation/match.py` | new | Pure classification rules above. |
| `src/ingestion/edgar/evaluation/runner.py` | new | Per-ticker orchestration, one ticker at a time. |
| `src/ingestion/edgar/cli.py` | modify | `edgar eval` command. |
| `tests/fixtures/edgar/aapl_eps_dims.htm` | new | Demo copy plus a `USD/shares` EPS fact, a dimensional context, a fixed-zero dash and `decimals="INF"`. |
| `tests/fixtures/edgar/companyfacts_aapl_sample.json` | new | One wrong value, one missing key, rows for another accession. |
| `tests/test_edgar_eval.py` | new | Offline tests. |
| `.github/workflows/ci.yml` | modify | Add the test file to the ruff line. |

`extract.py` and `src/ingestion/edgar/demo/*.htm` are not touched.
The report writers, regex ablation, Makefile target and
`docs/EDGAR_EVAL.md` come in the second slice.

## CLI

```shell
python -m ingestion edgar eval [--tickers AAPL ...] [--form 10-K] \
    [--file PATH --accession ACCN --cik CIK --companyfacts PATH] \
    [--user-agent UA] [--max-facts 5000] [--fail-under-recall FLOAT]
```

The `--file`, `--accession`, `--cik` and `--companyfacts` flags make the
run fully offline.
The exit code is 1 when `--fail-under-recall` is set and recall falls
below it.

## Test gate

Offline, no network or DB:

```shell
.venv/bin/pytest tests/test_edgar_eval.py tests/test_edgar_extract.py \
    tests/test_edgar_cli.py tests/test_edgar_client.py -q
.venv/bin/ruff check src/ingestion/edgar tests/test_edgar_eval.py
.venv/bin/ruff format --check src/ingestion/edgar tests/test_edgar_eval.py
```

Acceptance criteria:

- Rows from other accessions are dropped.
- The dimensional fact is counted unverifiable.
- The deliberately wrong fixture value is `value_mismatch`.
- Scale, sign and fixed-zero values are correct.
- EPS resolves to `USD/shares` and the stored `USD` is flagged
  `unit_mismatch`.
- Percent 3.6 vs 0.036 is accepted and flagged.
- The CLI prints the per-concept table and exits 0;
  `--fail-under-recall 1.01` exits 1.

Live gate, after approval, run alone under `/usr/bin/time -l`:
`python -m ingestion edgar eval --tickers AAPL`.
It must print real numbers, keep peak RSS under about 1 GB, and any
parse fidelity well below 1.0 gets investigated before anything is
published.

## Builder's calls

These are calls made without the user and can be overridden:

- Python, beside the extractor it scores, with no new dependencies.
- File output only, with no `eval_runs` table.
- Latest 10-K per ticker for the first run.
- Ruff line length 100, not google-python's 80, to match the repo.

## Effort

About 4 days in total.
The MVP slice (iXBRL pass, one ticker) is about 1 day.
