# Spider Desktop: the spider on any web page

This document is the contract shared by the injected overlay
(`desktop/overlay`, TypeScript) and the native Mac app
(`desktop/SpiderDesktop`, Swift).
If you change a message or a field here, change it in both places.
The fact model deliberately mirrors `docs/EDGAR_SPIDER.md`.

## Why

The EDGAR Spider only walks 10-Ks that were ingested into Postgres, and only
inside the Next.js viewer.
Spider Desktop takes the same spider to any web page, on demand, from a native
window that stays on the Mac and can float above other windows.
The person using it decides three things: when it runs, how fast it walks, and
what it looks for.
Nothing leaves the machine.
There is no browser extension and no server in the loop.

## Goals

- Load any URL in a native window and run the spider over the rendered page,
  including pages that need JavaScript to show their content.
- Controls for when (Run, Pause, Reset, auto-run on load), how fast (a pace
  slider that applies mid-crawl), and what (toggleable detectors plus a custom
  pattern).
- A Found panel that fills up as the spider walks, like the viewer's.
- Export what was found as JSON or CSV.
- "Float on top" so the window can sit over other apps, Cluely-style.

## Non-goals (v1)

- Saving crawls to Postgres or the Go API.
- Hopping between pages (the `filing_links` idea) and global hotkeys.
- Inline XBRL tag reading in the overlay.
  The overlay is regex-only; the Python extractor stays the exact source for
  10-K facts.
- Windows or Linux builds.

## Anti-goals

- A Chrome extension, or anything that depends on the person's browser.
- Any network call other than loading the page the person asked for.
- A heavyweight runtime (Electron, Docker) on an 8 GB machine.

## Architecture

```text
desktop/overlay (TypeScript, esbuild)  ──►  overlay.js (one IIFE)
        │                                        │
        │  generated at build time               ▼
        └────────►  Sources/SpiderDesktop/Generated/OverlayScript.swift
                                                  │
desktop/SpiderDesktop (SwiftPM, AppKit + WebKit)  │
   NSWindow ── control bar ── WKWebView ◄─────────┘ WKUserScript, document end,
                                 ▲  │                main frame, isolated world
   window.webkit.messageHandlers ┘  └─ window.__spider.command(json)
```

- The app injects `overlay.js` into every page in a private
  `WKContentWorld` named `cloudsearch-spider`.
  Page scripts cannot see the overlay's globals; the overlay shares the DOM.
- The overlay installs `window.__spider` (in that world) and posts messages
  to the native handler named `spider`.
- The app never fetches page HTML itself; WebKit renders the page as a
  browser would, so JavaScript-built pages work.

## Facts

```ts
interface Fact {
  index: number;      // 0-based, document order
  id: string;         // "f-00042"; equals data-fact-id on the span
  category: 'revenue' | 'debt' | 'shares' | 'other' | 'custom';
  kind: 'money' | 'percent' | 'shares' | 'date' | 'entity' | 'text';
  text: string;       // exact matched text, whitespace collapsed
  label: string;      // short label from the words before the match
  value: number | null;
  unit: 'USD' | 'percent' | 'shares' | null;
  context: string;    // surrounding block text, at most 240 characters
}
```

Markup for a found fact (the span wraps part of one text node, never an
element, and never nests):

```html
<span class="cs-fact cs-fact--hit" data-fact-id="f-00042"
      data-category="debt" data-kind="percent">3.600% Notes due 2042</span>
```

## Detectors

Each detector is a toggle.
Defaults are what a first run uses; the app remembers changes.

| detector  | default | example                    | category                          | kind    | value            |
| --------- | ------- | -------------------------- | --------------------------------- | ------- | ---------------- |
| `notes`   | on      | `3.600% Notes due 2042`    | `debt`                            | percent | 3.6              |
| `money`   | on      | `$24.6 billion`, `$1,234`  | by context, else `other`          | money   | 24600000000      |
| `shares`  | on      | `14,776,353,000 shares`    | `shares`                          | shares  | 14776353000      |
| `percent` | on      | `12.5%`, `12 %`            | by context, else `other`          | percent | 12.5             |
| `date`    | on      | `September 27, 2025`       | `other`                           | date    | null             |
| `number`  | off     | `1,234,567`                | by context, else `other`          | text    | 1234567          |
| `email`   | off     | `ir@example.com`           | `other`                           | entity  | null             |
| `custom`  | on when the pattern is non-empty | `iPhone, Mac` or `/Q[1-4] 20\d\d/` | `custom` | text | null |

Rules:

- Money accepts `$`, `€`, `£`, `¥`, a grouped or plain number, and an
  optional `thousand`, `million`, `billion`, `trillion` multiplier.
  `unit` is `USD` for `$`, otherwise null.
- `percent` is `0`–`999` with optional decimals, optional space, then `%`.
- `date` accepts `Month D, YYYY`, `Mon D, YYYY`, `D Month YYYY`,
  `YYYY-MM-DD`, and `MM/DD/YYYY`.
- `custom` is a comma-separated list of words, matched case-insensitively
  as whole words, or a single `/regex/` (flags `gi` are added).
  A pattern that fails to compile is reported as an `error` message and
  ignored.
- Context classification, same as `classify_context` in
  `src/ingestion/edgar/classify.py`: debt words
  (`notes`, `debt`, `borrow*`, `interest`, `coupon`, `commercial paper`,
  `credit facility`, `indenture`, `principal`, `matur*`, `repay*`,
  `financing`, `term loan`, `lease liabilit*`) win over revenue words
  (`net sales`, `revenue(s)`, `sales`), which win over share words
  (`share(s)`, `repurchas*`, `dividend(s)`, `outstanding`).
- When matches overlap inside one text node the earliest start wins; on a
  tie the detector listed first in the table above wins.
  So `3.600% Notes due 2042` is one `notes` fact, not a percent plus text.
- `label` follows `label_for_match` in `classify.py`: up to six words before
  the match, with leading fillers (`in 2025,`, `the`, `approximately`) and
  trailing weak words (`was`, `of`, `to`, …) removed; fewer than two words
  left falls back to the first six words of the context.
- The scan stops after 400 facts and reports `truncated: true`.

Text the scan never looks inside: `script`, `style`, `noscript`,
`template`, `textarea`, `input`, `select`, `svg`, `head`, `title`,
`ix:header`, `ix:hidden`, the overlay's own root, and any element that
`checkVisibility()` reports hidden when the browser supports it.

## Messages

Overlay to app, via `window.webkit.messageHandlers.spider.postMessage`:

| type      | fields                                            | when                               |
| --------- | ------------------------------------------------- | ---------------------------------- |
| `ready`   | `url`, `title`                                    | overlay installed on a page        |
| `scanned` | `total`, `truncated`, `counts` (per category)     | after a scan                       |
| `visit`   | `index`, `total`, `fact`                          | spider arrived at a fact           |
| `state`   | `state`: `idle`, `running`, `paused`, `done`      | state changed                      |
| `facts`   | `url`, `title`, `facts`                           | reply to `export`                  |
| `error`   | `message`                                         | bad custom pattern, internal error |

App to overlay, by evaluating `window.__spider.command(<json>)` in the
overlay's content world:

| cmd         | fields                                   | effect                                  |
| ----------- | ---------------------------------------- | --------------------------------------- |
| `configure` | `detectors` (name → bool), `custom`, `paceMs` | replaces settings; a running crawl is reset |
| `run`       |                                          | scans if needed, then walks; resumes a pause |
| `pause`     |                                          | stops at the current fact               |
| `reset`     |                                          | unwraps spans, clears panel, idle       |
| `setPace`   | `paceMs`                                 | applies from the next hop               |
| `goto`      | `index`                                  | jumps the spider there, continues       |
| `export`    |                                          | replies with `facts`                    |

`paceMs` is the time between two hops, 60 to 1500 (default 350).

## Overlay UI

- A fixed, full-viewport SVG layer (`pointer-events: none`,
  `z-index: 2147483647`) with the viewer's procedural spider: eight
  two-bone IK legs, tetrapod gait, spring-damped body, dragline, silk
  trail through recent facts.
  The port keeps the geometry constants of
  `web/components/spider/Spider.tsx`.
- The spider walks to the centre of the current span's bounding box, and the
  page scrolls the span to the centre of the viewport first (smooth unless
  `prefers-reduced-motion`).
- The Found panel is a fixed 300 px panel on the right inside a shadow root:
  header `Found · n of N`, chips per category with live counts (click to
  filter), one row per visited fact (colour bar, mono value, label,
  category), newest at the bottom and kept in view.
  Clicking a row sends `goto`.
  A chevron collapses it to the header.
- Colours are fixed (foreign pages have no theme): background `#0b0e14`,
  text `#e6e9ef`, revenue `#46c46a`, debt `#f5a623`, shares `#e879a6`,
  other `#8b95a7`, custom `#3dd6d0`.

## Native window

One `NSWindow`, 1180 × 800 by default, transparent title bar, a two-row
control bar on an `NSVisualEffectView`, then the `WKWebView`.

Row 1: Back, Forward, URL field (⌘L focuses it; Return loads), Reload (⌘R),
Float on top (⌃⌘F), Auto-run.

Row 2: Run / Pause (⌘↩), Reset (⇧⌘R), Speed slider with a `350 ms` label,
`Get ▾` pull-down with one checkable item per detector, custom pattern field,
status (`Found 17 of 70`), Export… (⌘E).

- Float on top sets `window.level = .floating` and
  `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`.
- Auto-run sends `configure` then `run` after every page load.
- Export asks for a file with `NSSavePanel`; `.json` writes
  `{ "url", "title", "capturedAt", "facts" }`, `.csv` writes the columns
  `index,id,category,kind,text,label,value,unit,context` with RFC 4180
  quoting.
- `UserDefaults` keys: `crawlSettings` (the settings struct as JSON:
  `detectors`, `customPattern`, `paceMs`, `autoRun`, `floatOnTop`) and
  `lastURL`, which is reloaded on the next launch.
- Target `_blank` links open in the same view.
  The Web Inspector is enabled.
- Menu bar: Spider (About, Quit), Edit (standard items so copy and paste
  work in text fields), Crawl (Run/Pause, Reset, Export…, Float on Top,
  Auto-run on Load), View (Open Location, Reload, Back, Forward), Window.

## Self-test mode

```sh
SpiderDesktop --self-test <path-or-url> [--timeout 60]
```

Loads the target, sends `configure` with every detector on and
`paceMs: 1`, then `run`, and when `state: done` arrives prints one JSON line
`{"url", "total", "counts", "visited"}` to stdout and exits 0.
Any `error` message, or no `done` before the timeout, prints the reason to
stderr and exits 1.
This is the integration test for the Swift–JavaScript bridge; `make
desktop-test` runs it against `src/ingestion/edgar/demo/aapl_10k_sample.htm`.

## Build

```sh
make desktop-overlay   # pnpm install + build overlay.js + Generated/OverlayScript.swift
make desktop-build     # overlay, then swift build -c release
make desktop-run       # build, then launch the binary
make desktop-app       # desktop/build/Spider.app with an Info.plist
make desktop-test      # overlay unit tests + typecheck, then the self-test on the demo 10-K
```

`desktop/overlay/dist/`, `**/Generated/`, `.build/` and `desktop/build/` are
build outputs and are ignored by git.
`swift test` needs XCTest, which ships with Xcode rather than the Command
Line Tools, so the Swift unit tests under `SpiderDesktop/Tests/` are not part
of `make desktop-test`; the self-test is the Swift-side gate.
