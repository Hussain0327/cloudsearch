# EDGAR Spider: data and API contract

This document is the single source of truth shared by the Python extractor,
the Go API, and the Next.js viewer. If you change a field here, change it in
all three places.

## What the feature does

1. The Python side fetches a company's latest Form 10-K primary document from
   SEC EDGAR, extracts structured facts (revenue, debt and financing, share
   counts, and other notable figures), wraps every fact in the original HTML
   with a `<span data-fact-id>` marker, and stores the filing, the facts, and
   cross-filing links in Postgres.
2. The Go API serves filings, facts, the annotated document, and a paced
   Server-Sent Events replay of the facts in document order (the "crawl").
3. The viewer renders the annotated document, consumes the crawl stream, and
   walks an SVG spider from fact to fact while the Found panel fills up.

## Universe

Five tickers for v1: `AAPL`, `MSFT`, `AMZN`, `GOOGL`, `NVDA`. Company mentions
of any ticker in the universe found inside another filing become
`filing_links` rows, which is what lets the spider hop between documents.

## Database (alembic revision 002)

### `filings`

| column            | type        | notes                                         |
| ----------------- | ----------- | --------------------------------------------- |
| id                | bigserial   |                                               |
| cik               | text        | zero-padded 10-digit CIK                      |
| ticker            | text        | upper case                                    |
| company_name      | text        |                                               |
| form_type         | text        | `10-K` for v1                                 |
| accession_number  | text UNIQUE | `0000320193-25-000079` (with dashes)          |
| filed_at          | date        | nullable                                      |
| period_of_report  | date        | nullable                                      |
| fiscal_year       | integer     | nullable                                      |
| source_url        | text        | the EDGAR archive URL of the primary document |
| content_hash      | varchar(64) | SHA-256 of raw_html                           |
| raw_html          | text        | as fetched                                    |
| annotated_html    | text        | sanitized and marked up, see below            |
| fact_count        | integer     | denormalized `COUNT(facts)`                   |
| created_at        | timestamptz |                                               |
| updated_at        | timestamptz |                                               |

### `facts`

| column        | type    | notes                                                              |
| ------------- | ------- | ------------------------------------------------------------------ |
| id            | bigserial |                                                                  |
| filing_id     | bigint  | FK filings, cascade                                                |
| fact_index    | integer | 0-based, document order; UNIQUE with filing_id                     |
| dom_id        | text    | `f-00042`; equals the `data-fact-id` attribute in annotated_html    |
| category      | text    | one of `revenue`, `debt`, `shares`, `other`                        |
| kind          | text    | one of `money`, `percent`, `shares`, `date`, `entity`, `text`      |
| raw_text      | text    | the exact span text, e.g. `3.600% Notes due 2042`                  |
| label         | text    | short human label, e.g. `Notes due 2042`                           |
| value_numeric | numeric | parsed value, nullable (`3.6`, `3253431000000`)                    |
| unit          | text    | `USD`, `percent`, `shares`, or null                                |
| context       | text    | surrounding sentence, at most 300 characters                       |
| section       | text    | `Cover`, `Item 1A`, `Item 7`, `Item 8`, or `` when unknown         |
| concept       | text    | iXBRL concept name when the fact came from an `ix:` tag, else null |
| source        | text    | `ixbrl`, `regex`, or `entity`                                      |

### `filing_links`

| column           | type    | notes                                                   |
| ---------------- | ------- | ------------------------------------------------------- |
| id               | bigserial |                                                       |
| filing_id        | bigint  | the filing in which the mention occurs                  |
| fact_index       | integer | the `entity` fact that is the mention                   |
| dom_id           | text    | same dom_id as that fact                                |
| target_ticker    | text    | the mentioned company's ticker                          |
| target_filing_id | bigint  | that company's filing if it is indexed, else null       |
| mention_text     | text    | e.g. `Microsoft`                                        |

## Annotated HTML markup

The extractor sanitizes the filing (drops `script`, `link`, `meta`, `iframe`,
`object`, `embed`, event-handler attributes, and `javascript:` URLs, and
rewrites relative `img src` and `a href` to absolute `https://www.sec.gov`
URLs) and wraps each fact:

```html
<span class="cs-fact" id="f-00042" data-fact-id="f-00042"
      data-category="debt" data-kind="percent">3.600% Notes due 2042</span>
```

Rules:

- `dom_id` values are `f-` plus a 5-digit zero-padded `fact_index`.
- A fact span never contains another fact span.
- Inline XBRL tags (`ix:nonfraction`, `ix:nonnumeric`) are kept in the
  document; the `cs-fact` span wraps the `ix:` element.
- Cover-page section detection: everything before the first "PART I" heading
  is `Cover`. Thereafter the section is the most recent `Item N` heading.

## Go API (all under `/api/v1`, rate limited like `/search`)

### `GET /filings`

```json
{
  "filings": [
    {
      "id": 1,
      "cik": "0000320193",
      "ticker": "AAPL",
      "company_name": "Apple Inc.",
      "form_type": "10-K",
      "accession_number": "0000320193-25-000079",
      "filed_at": "2025-10-31",
      "period_of_report": "2025-09-27",
      "fiscal_year": 2025,
      "source_url": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      "fact_count": 388,
      "counts": { "revenue": 41, "debt": 112, "shares": 19, "other": 216 },
      "updated_at": "2026-10-16T21:00:00Z"
    }
  ]
}
```

`filed_at` and `period_of_report` are `YYYY-MM-DD` strings or null.
`fiscal_year` is an integer or null.

### `GET /filings/{id}`

Returns the same filing object plus `facts` (all facts in `fact_index` order)
and `links`:

```json
{
  "filing": { "...": "as above" },
  "facts": [
    {
      "id": 9,
      "filing_id": 1,
      "fact_index": 8,
      "dom_id": "f-00008",
      "category": "debt",
      "kind": "percent",
      "raw_text": "3.600% Notes due 2042",
      "label": "Notes due 2042",
      "value_numeric": 3.6,
      "unit": "percent",
      "context": "3.600% Notes due 2042 AAPL The Nasdaq Stock Market LLC",
      "section": "Cover",
      "concept": "dei:Security12bTitle",
      "source": "ixbrl"
    }
  ],
  "links": [
    {
      "id": 1,
      "filing_id": 1,
      "fact_index": 211,
      "dom_id": "f-00211",
      "target_ticker": "MSFT",
      "target_filing_id": 2,
      "mention_text": "Microsoft"
    }
  ]
}
```

`value_numeric` is a JSON number or null. `concept` is a string or null.
`target_filing_id` is a number or null.

### `GET /filings/by-ticker/{ticker}`

Latest indexed filing for a ticker, same shape as `GET /filings/{id}`.
404 with `{"error":"filing not found"}` when none.

### `GET /filings/{id}/document`

`Content-Type: text/html; charset=utf-8`, body is `annotated_html`. Also sets
`Content-Security-Policy: default-src 'none'; img-src https://www.sec.gov data:; style-src 'unsafe-inline'`
and `X-Content-Type-Options: nosniff`.

### `GET /filings/{id}/crawl?pace_ms=120&from=0&categories=revenue,debt`

Server-Sent Events. Facts are replayed in `fact_index` order starting at
`from`, one per `pace_ms` milliseconds (default 120, min 0, max 5000), only
those whose category is in `categories` when that parameter is given.

Events, in order:

```
event: start
data: {"filing_id":1,"ticker":"AAPL","company_name":"Apple Inc.","total":388,"streaming":310}

event: fact
data: {"id":9,"filing_id":1,"fact_index":8,"dom_id":"f-00008", ... same Fact object ...}

event: link
data: {"id":1,"filing_id":1,"fact_index":211,"dom_id":"f-00211","target_ticker":"MSFT","target_filing_id":2,"mention_text":"Microsoft"}

event: done
```

`total` is the filing's fact_count; `streaming` is how many facts this
stream will emit after filtering. A `link` event is emitted immediately after
the `fact` event of the same `fact_index`. The server stops when the client
disconnects. Errors are `event: error` with a plain-text `data:` line.

### `GET /stats`

Gains `total_filings` and `total_facts` integer fields. Existing fields are
unchanged.

## Next.js proxy routes

| Browser                           | Upstream                               |
| --------------------------------- | -------------------------------------- |
| `GET /api/filings`                | `GET /api/v1/filings`                  |
| `GET /api/filings/{id}`           | `GET /api/v1/filings/{id}`             |
| `GET /api/filings/{id}/document`  | `GET /api/v1/filings/{id}/document`    |
| `GET /api/filings/{id}/crawl?...` | `GET /api/v1/filings/{id}/crawl?...`   |
| `GET /api/filings/by-ticker/{t}`  | `GET /api/v1/filings/by-ticker/{t}`    |

The crawl proxy pipes the SSE body through unbuffered, exactly like the
search proxy does.

## Category colors (viewer)

| category | token         | hex (dark) |
| -------- | ------------- | ---------- |
| revenue  | `--success`   | `#46c46a`  |
| debt     | `--accent`    | `#f5a623`  |
| shares   | `--cat-shares`| `#e879a6`  |
| other    | `--text-muted`| `#5c6678`  |

`--cat-shares` is new and must be defined in `globals.css` for both themes.

## Python CLI

```
python -m ingestion edgar ingest --tickers AAPL MSFT        # live, needs network
python -m ingestion edgar extract-file path/to/10k.htm      # offline, prints facts
python -m ingestion edgar seed-demo                         # offline fixture -> Postgres
```

`SEC_USER_AGENT` must be set for live fetches, in the form
`"Name email@example.com"`, per the SEC fair-access policy. Requests are
limited to 8 per second.
