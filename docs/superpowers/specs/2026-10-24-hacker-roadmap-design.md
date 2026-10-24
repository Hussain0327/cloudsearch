# Hacker-level roadmap: design

Date: 2026-10-24.
Status: draft, awaiting approval.

This covers five features for EDGAR Spider:
an extraction eval harness (#7), an MCP server (#6), an open dataset (#10),
local small-model extraction (#9), and system-wide capture (#8).
Each is its own project with its own spec.
This document fixes the order and the pieces they share.
The first spec is
[2026-10-24-edgar-eval-harness-design.md](2026-10-24-edgar-eval-harness-design.md).

## Why this order

| Order | Item | Reason |
| ----- | ---- | ------ |
| 1 | #7 eval harness | Nothing has ever run the extractor on a real 10-K. Today's only fixtures are two synthetic samples. #9 is gated on its numbers, and #10 must not publish unscored data. No DB, no new deps. |
| 2 | #6 MCP server | The MVP tools work on the current schema (alembic 002). Cheap distribution. |
| 3 | #10 open dataset | Outward-facing and hard to retract. It ships only after #7 numbers and structured period/unit columns exist. |
| 4 | #8 system-wide capture | Largest and riskiest (TCC, code signing, per-app AX quality). Its no-permission MVP can be done any time. |
| 5 | #9 local model | Heaviest on 8 GB RAM. Most of its target gaps are regex-fixable, so fix the regexes first and measure with #7. |

## Shared foundations

Build each of these once.

1.  **`src/ingestion/edgar/ixbrl.py`**: a pure parser for iXBRL contexts
    (start, end, instant, dimensional), units (divide units resolve to
    `USD/shares`), and per-tag observations (name, contextref, unitref,
    decimals including `INF`, scale, sign, format, value, dom_id, hidden,
    nested).
    Today `_parse_contexts` keeps only a display string and `_unit_from_ref`
    maps any `usd` substring to `USD`.
    #7 uses it first, without changing the extractor.
2.  **Alembic 003**: structured fact columns (period_start, period_end,
    period_instant, unit_measure, decimals, context_ref, is_dimensional).
    It lands only after #7 validates the parser on real filings, and it
    must update `docs/EDGAR_SPIDER.md`, the Python store, the Go models
    and store column list, and `web/lib/filings-types.ts` together.
    An `llm` value in the `facts_source_check` constraint waits for a
    separate 004, and only if #9 passes its bar.
3.  **`EdgarClient` extensions**: `companyfacts(cik)` and
    `filings(ticker, form, limit=N)`.
    Both share the 8 rps limiter and the User-Agent check.
4.  **Local filing cache** under `.cache/edgar/`, which is already
    gitignored.
    #7, #9 and #10 all reuse it, so SEC is hit once.
    `src/ingestion/edgar/demo/*.htm` stays untouched because
    `make desktop-test` depends on it.
    New edge cases go in copies under `tests/fixtures/edgar/`.
5.  **`src/ingestion/edgar/queries.py`**: a read-only asyncpg query layer
    for #6 and #10.
6.  **Logging to stderr**: structlog prints to stdout by default.
    That would corrupt MCP stdio (#6) and machine-read output (#7, #10).
7.  **Regex improvement loop**: handle "3.6 percent", "2.5 billion
    shares", ungrouped share counts and "USD 1.2 billion" in `extract.py`
    and `desktop/overlay/src/detectors.ts`.
    #7 scores every change before and after.

## Repo conventions

- Python follows google-python, except that line length stays at the
  repo's ruff setting of 100 so CI and existing files stay consistent.
- CI already lints all of `src/ingestion/edgar`.
  Only new test files need adding to the ruff line in `ci.yml`.
- No package named `eval`, because it shadows the builtin.
  Use `evaluation`.
- No Docker.
  Postgres runs under Apple `container`.
- No XCTest.
  The Swift gate is `--self-test`.

## Per-item MVP slices

These come from the judge pass.
Each one gets a full spec before it is built.

- **#6 MCP server (about 2 days)**: `queries.py` plus three FastMCP tools
  over stdio (`list_filings`, `get_facts`, `get_provenance`).
  `compare_concept` waits for alembic 003, because the period text in
  `facts.context` is truncated on wide table rows.
  `mcp` is an optional extra, and CI installs it so the schema test runs.
- **#10 open dataset (about 3 days)**: start offline with
  `edgar export --from-file` writing facts and filings Parquet plus a
  manifest.
  No network, no GitHub Action, no Hugging Face upload until publishing
  is approved.
  The pitch rests on the narrative facts with provenance, because the
  iXBRL rows duplicate what SEC already publishes.
- **#8 system-wide capture (about 5.5 days)**: the MVP needs no
  permissions.
  Move `buildFact` and `factId` into `overlay/src/fact.ts`, add a
  DOM-free text bundle that runs in JavaScriptCore, and gate it with
  `--self-test-text` against a golden file shared with the node tests.
  Accessibility and ScreenCaptureKit are manual-checklist items, since
  the self-test cannot hold TCC grants.
- **#9 local model (about 4.5 days)**: regex fixes come first.
  Then an optional Ollama backend (localhost only, `keep_alive=0`)
  feeds an `extra_spans` hook into `FilingExtractor.extract`, so no
  fact renumbering is needed.
  It is off by default.

## Decisions still open

These change what gets built, so they are the user's call.

1.  SEC_USER_AGENT contact string for live runs.
2.  companyfacts as primary ground truth, with frames as a sampled
    cross-check (#7).
3.  Benchmark scope: latest 10-K or last N per ticker, and whether to
    grow beyond five companies before publishing.
4.  Publishing: whether, where (Hugging Face account and repo), license
    (CC0-1.0 or CC-BY-4.0), and when.
5.  #9: regex first, then Ollama (about 3 GB while running) for the rest.
6.  #8: a local self-signed code-signing identity in Keychain, a floating
    results panel for v1, and which apps must work on day one.
7.  #6: read Postgres directly instead of through new Go endpoints.
