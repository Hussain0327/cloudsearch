# Spider Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Mac window that loads any web page and runs the EDGAR
spider over it, with controls for when, how fast, and what it collects.

**Architecture:** A TypeScript overlay (scan, crawl, spider, panel) is bundled
to one script and embedded in a SwiftPM AppKit app that injects it into a
`WKWebView` in an isolated content world.
A small JSON message protocol connects the two.

**Tech Stack:** TypeScript 5 + esbuild + node:test + jsdom; Swift 6 (CLT
toolchain, Swift 5 language mode) + AppKit + WebKit; GNU make.

**Spec:** `docs/DESKTOP_SPIDER.md`

## Global Constraints

- macOS 14 or newer, Apple Silicon; build with the Command Line Tools only
  (no Xcode project).
- No Docker, no Electron, no new system daemons.
- Google style guides: `google-typescript`, `google-swift`, `google-shell`,
  `google-markdown`, `google-json`.
- Fact field names exactly as in the spec; categories
  `revenue|debt|shares|other|custom`; `paceMs` 60–1500, default 350.
- Scan cap 400 facts; context at most 240 characters.
- Never commit without the user's go-ahead.

## Review Focus

- A page with thousands of numbers (a stock table): the scan must stop at
  400 and say so (`truncated`) rather than hang. Task 3 tests the cap.
- A custom pattern that is an invalid regex (`/(/`): report `error`, keep
  the other detectors working. Task 1 tests the compile failure.
- Spans must not break page layout: a match split across two text nodes
  (`<b>$24.6</b> billion`) is simply not matched. Task 3 tests that no span
  crosses an element boundary.
- A second `run` after `reset` must not double-wrap or renumber oddly.
  Task 3 tests idempotent reset + rescan.
- The slider moved mid-crawl: the next hop uses the new pace, the current
  one is not cut short. Task 4 tests `setPace` timing.

---

### Task 1: Overlay package and detectors

**Files:**

- Create: `desktop/overlay/package.json`, `desktop/overlay/tsconfig.json`
- Create: `desktop/overlay/src/detectors.ts`
- Test: `desktop/overlay/src/detectors_test.ts`

**Interfaces:**

- Produces:

  ```ts
  type Category = 'revenue' | 'debt' | 'shares' | 'other' | 'custom';
  type Kind = 'money' | 'percent' | 'shares' | 'date' | 'entity' | 'text';
  type DetectorName = 'notes' | 'money' | 'shares' | 'percent' | 'date' | 'number' | 'email' | 'custom';
  interface DetectorConfig { detectors: Record<DetectorName, boolean>; custom: string; }
  interface Match { start: number; end: number; text: string; detector: DetectorName; kind: Kind; value: number | null; unit: Unit; label?: string; }
  const DEFAULT_CONFIG: DetectorConfig;
  function compileDetectors(config: DetectorConfig): { detectors: CompiledDetector[]; error?: string };
  function findMatches(text: string, detectors: CompiledDetector[]): Match[];  // sorted, non-overlapping
  function classifyContext(context: string, kind: Kind): Category;
  ```

- [ ] **Step 1: Write failing tests** `detectors_test.ts` (node:test):
      `money parses $24.6 billion`, `notes beats percent on 3.600% Notes due 2042`,
      `shares parses grouped count`, `percent with interest context is debt`,
      `date matches long and iso forms`, `custom words match whole words case-insensitively`,
      `custom regex form`, `invalid custom regex reports error and keeps others`,
      `disabled detector yields nothing`, `overlaps resolve to earliest start`.
- [ ] **Step 2: Run** `pnpm test` → FAIL (module missing).
- [ ] **Step 3: Implement** `detectors.ts` with the regexes from
      `src/ingestion/edgar/extract.py` (`_NOTES_RE`, `_MONEY_RE`,
      `_SHARES_RE`, `_PERCENT_RE`) plus date, number, email, custom.
- [ ] **Step 4: Run** `pnpm test` → PASS; `pnpm typecheck` clean.

### Task 2: Labels and context

**Files:**

- Create: `desktop/overlay/src/label.ts`
- Test: `desktop/overlay/src/label_test.ts`

**Interfaces:**

- Produces: `labelForMatch(context: string, matchText: string, maxWords = 6): string`,
  `clipContext(blockText: string, matchStart: number, matchLength: number, max = 240): string`.

- [ ] **Step 1: Tests:** `label prefers the clause before the figure`
      (`Total net sales increased 2% to $391.0 billion` → `Total net sales increased`),
      `label drops leading year filler`, `label falls back to sentence start when too short`,
      `clipContext centres on the match and collapses whitespace`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

### Task 3: DOM scan

**Files:**

- Create: `desktop/overlay/src/scan.ts`
- Test: `desktop/overlay/src/scan_test.ts` (jsdom)

**Interfaces:**

- Consumes Task 1 and 2.
- Produces: `scanDocument(doc: Document, config: DetectorConfig, options?: { maxFacts?: number; skipRootId?: string }): ScanResult`
  where `ScanResult = { facts: Fact[]; truncated: boolean; error?: string }`,
  and `unwrapFacts(doc: Document): void`.

- [ ] **Step 1: Tests:** `wraps matches in cs-fact spans in document order`,
      `skips script, style and the overlay root`, `never crosses an element boundary`,
      `stops at maxFacts and reports truncated`, `unwrap then rescan yields identical ids`,
      `fact carries category, label and context`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** using `splitText` +
      `insertBefore` (no `Range`). **Step 4: Run** → PASS.

### Task 4: Crawler

**Files:**

- Create: `desktop/overlay/src/crawler.ts`
- Test: `desktop/overlay/src/crawler_test.ts`

**Interfaces:**

- Produces:

  ```ts
  type CrawlState = 'idle' | 'running' | 'paused' | 'done';
  interface Scheduler { set(fn: () => void, ms: number): number; clear(id: number): void; }
  class Crawler {
    constructor(opts: { onVisit(index: number): void; onState(s: CrawlState): void; scheduler?: Scheduler });
    load(total: number): void; run(): void; pause(): void; reset(): void;
    setPace(ms: number): void; goto(index: number): void;
    readonly state: CrawlState; readonly position: number; readonly paceMs: number;
  }
  ```

- [ ] **Step 1: Tests** with a manual scheduler: `run visits index 0 immediately then one per pace`,
      `pause stops scheduling and run resumes at the next index`,
      `setPace applies to the next hop only`, `goto jumps and continues`,
      `reaching the end emits done`, `paceMs is clamped to 60..1500`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

### Task 5: Spider sprite, panel, bridge, entry, build script

**Files:**

- Create: `desktop/overlay/src/spider-sprite.ts` (port of
  `web/components/spider/Spider.tsx` to a class driving an SVG),
  `desktop/overlay/src/panel.ts`, `desktop/overlay/src/styles.ts`,
  `desktop/overlay/src/bridge.ts`, `desktop/overlay/src/main.ts`,
  `desktop/overlay/scripts/build.ts`
- Test: `desktop/overlay/src/panel_test.ts` (jsdom): `rows are grouped and filtered by category chip`.

**Interfaces:**

- `main.ts` installs `window.__spider = { command(json: string): void }` and
  posts the spec's messages through `bridge.ts`
  (`postMessage(msg: OverlayMessage): void`, which no-ops when
  `window.webkit` is missing so the bundle also runs in a plain browser for
  manual checks).
- `scripts/build.ts` bundles `src/main.ts` to `dist/overlay.js` (IIFE,
  target `safari17`) and writes
  `../SpiderDesktop/Sources/SpiderDesktop/Generated/OverlayScript.swift`
  containing `enum OverlayScript { static let source = ##"""…"""## }`.

- [ ] **Step 1:** panel test → FAIL → implement → PASS.
- [ ] **Step 2:** `pnpm build` produces both files; `pnpm typecheck` clean.

### Task 6: Swift export writer and settings

**Files:**

- Create: `desktop/SpiderDesktop/Package.swift`,
  `Sources/SpiderDesktop/ExportWriter.swift`,
  `Sources/SpiderDesktop/CrawlSettings.swift`
- Test: `Tests/SpiderDesktopTests/ExportWriterTests.swift`,
  `Tests/SpiderDesktopTests/CrawlSettingsTests.swift`

**Interfaces:**

- `struct FactRecord: Codable` (spec fields), `enum ExportWriter { static func csv(_ facts: [FactRecord]) -> String; static func json(url: String, title: String, facts: [FactRecord], capturedAt: Date) throws -> Data }`.
- `struct CrawlSettings: Codable, Equatable { var detectors: [String: Bool]; var customPattern: String; var paceMs: Int; var autoRun: Bool; var floatOnTop: Bool; static let `default`; func configureCommand() -> String /* JSON */; static func pace(fromSlider v: Double) -> Int; static func slider(fromPace ms: Int) -> Double }`.
- The library target `SpiderDesktopCore` holds these so `swift test` works;
  the executable target `SpiderDesktop` holds AppKit code.

- [ ] **Step 1: Tests:** `csv quotes commas quotes and newlines`,
      `csv header matches the spec columns`, `json includes url title capturedAt facts`,
      `slider endpoints map to 1500 and 60 ms`, `configureCommand emits cmd configure`.
- [ ] **Step 2:** `swift test` → FAIL. **Step 3: Implement.** **Step 4:** → PASS.

### Task 7: The app

**Files:**

- Create: `Sources/SpiderDesktop/main.swift`, `AppDelegate.swift`,
  `SpiderWindowController.swift`, `ControlBar.swift`, `OverlayBridge.swift`,
  `SelfTest.swift`

- [ ] **Step 1:** Implement per spec "Native window" and "Self-test mode";
      `swift build` clean.
- [ ] **Step 2:** `.build/debug/SpiderDesktop --self-test src/ingestion/edgar/demo/aapl_10k_sample.htm`
      prints one JSON line with `total > 0` and `visited == total`, exit 0.

### Task 8: Build glue and docs

**Files:**

- Modify: `Makefile` (targets from the spec), `.gitignore`
- Create: `desktop/scripts/bundle-app.sh`, `desktop/README.md`
- Modify: `README.MD` (short "Spider Desktop" section pointing at the doc)

- [ ] **Step 1:** `make desktop-test` runs overlay tests, `swift test`, and the
      self-test; all green.
- [ ] **Step 2:** `make desktop-app` yields `desktop/build/Spider.app` that
      opens.
