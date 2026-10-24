# Spider Desktop

A native Mac window that loads any web page and runs the EDGAR spider over
it.
You choose when it runs, how fast it walks, and what it collects.
Nothing leaves the machine.
The contract between the two halves is in `../docs/DESKTOP_SPIDER.md`.

## Layout

| path                       | what                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `overlay/`                 | TypeScript injected into pages: scan, crawl, spider, panel  |
| `SpiderDesktop/`           | SwiftPM app: AppKit window, WebKit view, bridge, export     |
| `scripts/bundle-app.sh`    | wraps the release binary in `build/Spider.app`              |

## Build and run

Prerequisites: macOS 14+, the Xcode Command Line Tools (Swift 6), Node 22+,
pnpm.
From the repository root:

```sh
make desktop-run                 # build the overlay and the app, then launch it
make desktop-run ARGS="https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm"
make desktop-app                 # desktop/build/Spider.app
make desktop-test                # overlay unit tests + end-to-end self-test
```

In the window: type a URL and press Return, then **Run**.
The slider sets the pace between hops; **Get ▾** picks what to look for; the
custom field takes comma-separated words or a `/regex/`; **Float on top**
keeps the window above other apps; **Export…** saves JSON or CSV.

## Tests

- `pnpm test` in `overlay/` runs the unit tests (detectors, labels, scan,
  crawler) under `node:test` with jsdom.
- `SpiderDesktop --self-test <file-or-url>` loads a page, crawls it with every
  detector on, prints one JSON line and exits 0 when every fact was visited.
  `make desktop-test` runs it on `src/ingestion/edgar/demo/aapl_10k_sample.htm`.
- `SpiderDesktop --self-test-text <capture.txt>` runs the DOM-free text bundle
  in JavaScriptCore and compares with `<capture>.expected.json`; the node test
  `text-extract_test.ts` checks the same golden file (`fixtures/`). Regenerate
  it with `UPDATE_GOLDEN=1 pnpm test`. System-wide capture (Accessibility,
  screen OCR, hotkey) is not built yet; only this text core is.
- `swift test` needs XCTest, which ships with Xcode, not with the Command Line
  Tools; the test files under `SpiderDesktop/Tests/` are for machines that have
  it.
