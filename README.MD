# EDGAR Spider (on the CloudSearch stack)

A visual crawler for SEC filings. It fetches a company's Form 10-K from EDGAR,
extracts every notable figure (revenue, debt and financing, share counts, and
other key numbers) with exact positions in the document, and then an animated
spider walks the rendered filing from fact to fact while a "Found" panel fills
up. Mentions of other companies in the universe become links, so the spider
can hop from Apple's 10-K to Microsoft's.

Under it is the original CloudSearch stack: Python ingestion, a Go API with
SSE streaming, Postgres, and a Next.js front end. The AWS-docs search and RAG
features still work and are documented further down.

## How the spider works

```
EDGAR (data.sec.gov / www.sec.gov)
   │  submissions JSON → latest 10-K → primary iXBRL document
   ▼
Python: ingestion.edgar
   ├─ pass 1  Inline XBRL  ix:nonFraction / ix:nonNumeric → exact facts with concept names
   ├─ pass 2  regex over untagged text  "$24.6 billion", "3.600% Notes due 2042", "14,776,353,000 shares"
   ├─ pass 3  company mentions → filing_links (the "web" the spider crawls)
   └─ wraps each fact:  <span class="cs-fact" data-fact-id="f-00042" data-category="debt">…</span>
   ▼
Postgres: filings · facts · filing_links          (alembic revision 002)
   ▼
Go API:  GET /api/v1/filings/{id}/crawl  → SSE  start · fact · link · done   (paced replay)
   ▼
Next.js /filings/[id]:  annotated document + SVG spider with IK legs + Found panel
```

Contract for all three layers: [`docs/EDGAR_SPIDER.md`](docs/EDGAR_SPIDER.md).

## Quick start (spider)

```bash
# 0. Prerequisites: Docker, Go 1.23+, Python 3.11+, Node 22 + pnpm
make db-up && make setup && make migrate      # Postgres (pgvector image) + schema

# 1. Data: either the bundled offline samples...
make edgar-seed                               # synthetic Apple + Microsoft 10-K samples

#    ...or real filings from EDGAR (SEC requires a contact User-Agent)
export SEC_USER_AGENT="Your Name you@example.com"
make edgar-ingest ARGS="--tickers AAPL MSFT AMZN GOOGL NVDA"

# 2. API + web
make api-dev                                  # :8080  (terminal 2)
make web-dev                                  # :3000  (terminal 3)
open http://localhost:3000/filings
```

Or everything in containers: `make docker-up`, then
`docker compose run --rm edgar-seed`, then open http://localhost:3000/filings.

Try the extractor on any local filing without a database:

```bash
make edgar-extract FILE=path/to/aapl-20250927.htm ARGS="--ticker AAPL"
```

## Spider Desktop (Mac app)

The same spider as a native Mac window that works on **any web page**, not
only ingested 10-Ks: type a URL, press Run, and the spider walks the rendered
page while the Found panel fills up. You pick when it runs, how fast (the pace
slider), and what it collects (money, notes due, percentages, share counts,
dates, big numbers, emails, or your own words / regex). Float on top keeps it
above other apps; Export saves JSON or CSV. Nothing leaves the machine and no
browser extension is involved.

```sh
make desktop-run        # builds the overlay + app, then launches it
make desktop-app        # desktop/build/Spider.app
make desktop-test       # overlay unit tests + end-to-end self-test on the demo 10-K
```

Contract and design: `docs/DESKTOP_SPIDER.md`. Code: `desktop/`.

### Spider API

```
GET /api/v1/filings                      indexed filings with per-category counts
GET /api/v1/filings/{id}                 filing + facts (document order) + links
GET /api/v1/filings/by-ticker/{ticker}   latest filing for a ticker
GET /api/v1/filings/{id}/document        annotated HTML (sanitized, CSP'd)
GET /api/v1/filings/{id}/crawl           SSE replay: ?pace_ms=120&from=0&categories=revenue,debt
```

### What is real and what is sample data

`make edgar-seed` loads two **synthetic** filings bundled in
`src/ingestion/edgar/demo/`. They copy the structure of real Inline XBRL
10-Ks (cover page, securities table, TOC, Items, financial tables, hidden
iXBRL header) so the whole pipeline is exercised offline, but their figures
are illustrative. `make edgar-ingest` replaces them with the real documents.

### Status

- Extractor, store, API and viewer are complete and tested (Python 37 tests,
  Go handler tests with a fake store, web typecheck/lint/build in CI).
- Live EDGAR ingestion is implemented against the documented endpoints and
  fair-access rules but could not be run from the sandbox this was built in
  (no outbound access to sec.gov). First thing to do on your machine:
  `make edgar-ingest ARGS="--tickers AAPL"` and look at the fact list.
- Not done yet: a labeled precision/recall set for the extractor, and
  exhibit-level hops (indentures) for the spider.

---

# CloudSearch (AWS docs search + RAG)

Hybrid search engine for AWS documentation with RAG-powered answers. Fully open-source stack — no API keys required.

Crawls AWS docs, chunks them with semantic structure preservation, embeds with BGE-large-en-v1.5, indexes into PostgreSQL (pgvector + tsvector), runs hybrid vector + keyword retrieval with Reciprocal Rank Fusion, and generates cited answers via Llama 3.2 through Ollama.

## Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌───────────────┐
│   Python     │    │    Go API        │    │   Ollama      │
│   Ingestion  │───>│    Server        │───>│   (Llama 3.2) │
│   Pipeline   │    │    (Chi + pgx)   │    │               │
└──────┬───────┘    └────────┬─────────┘    └───────────────┘
       │                     │
       v                     v
┌──────────────────────────────────────────┐
│   PostgreSQL 16 + pgvector               │
│   - vector(1024) HNSW index              │
│   - tsvector GIN index                   │
│   - Hybrid search: vector + keyword      │
└──────────────────────────────────────────┘
```

**Three layers, each in the right language:**

| Layer               | Language   | Why                                                                                      |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| Ingestion pipeline  | Python     | sentence-transformers, tiktoken, BeautifulSoup — the ML ecosystem lives here             |
| API server          | Go         | Single binary, goroutine fan-out for concurrent search, SSE streaming, sub-ms serving    |
| Storage + retrieval | PostgreSQL | pgvector for dense similarity + tsvector for sparse keyword match in one DB, no Pinecone |

## What it does

**Ingestion** — Crawls AWS docs via BFS, parses HTML into a structural tree, chunks with type-aware strategies (prose, code, table, config), embeds with BGE-large-en-v1.5 (1024-dim, L2-normalized), indexes into Postgres with HNSW + GIN indexes.

**Search** — Embeds the query (with BGE asymmetric prefix), fans out vector search (`<#>` inner product) and keyword search (`ts_rank_cd` on weighted tsvector) concurrently via `errgroup`, fuses results with Reciprocal Rank Fusion (k=60), returns top-K ranked chunks.

**Generation** — Builds a numbered RAG prompt from retrieved chunks, streams the answer via Ollama (Llama 3.2), extracts `[N]` bracket citations that link back to source URLs. Two-level LRU cache (retrieval results + full answers) for repeat queries.

## Quick start

```bash
# Prerequisites: Docker, Go 1.22+, Python 3.11+, Ollama

# 1. Install Ollama and pull the model
brew install ollama
brew services start ollama
ollama pull llama3.2

# 2. Start Postgres
make db-up

# 3. Run schema migrations

make setup    # creates Python venv
make migrate

# 4. Ingest docs (or seed test data — see below)
make ingest ARGS="--services s3"

# 5. Start the embedding sidecar (terminal 2)
PYTHONPATH=src .venv/bin/python -m uvicorn api.embed_service.main:app --port 8081

# 6. Start the API server (terminal 3)
cd api && go run ./cmd/server

# 7. Search
curl -X POST localhost:8080/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"How do I set up an S3 bucket policy?","stream":true}'
```

## API

```
GET  /healthz              Liveness probe (always 200)
GET  /readyz               Readiness probe (checks DB + embed service)
GET  /api/v1/stats         Index statistics (docs, chunks, per-service)
POST /api/v1/search        Hybrid search + RAG answer generation
```

### POST /api/v1/search

```json
{
  "query": "How do I set up an S3 bucket policy?",
  "top_k": 5,
  "services": ["s3", "iam"],
  "stream": true
}
```

**Non-streaming response:**

```json
{
  "answer": "To set up an S3 bucket policy...",
  "citations": [
    {
      "chunk_id": 42,
      "document_url": "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html",
      "title": "Using bucket policies",
      "service_name": "s3",
      "section_path": "S3 > Bucket Policies > Examples",
      "score": 0.032
    }
  ],
  "metadata": {
    "query_time_ms": 2847,
    "chunks_found": 5,
    "cache_hit": false,
    "model": "llama3.2"
  }
}
```

**Streaming response (SSE):**

```
event: chunk
data: To set up

event: chunk
data: an S3 bucket policy

event: citations
data: [{"chunk_id":42,"document_url":"...","score":0.032}]

event: metadata
data: {"query_time_ms":2847,"chunks_found":5}

event: done
```

## Hybrid search: why it matters

Pure vector search misses exact matches on CLI flags and service names. Pure keyword search misses semantic similarity. Hybrid search returns the right result when either alone fails.

**Case study from our test suite** (`reranker_test.go:TestFuseRRF_CaseStudy_HybridBeatsEitherAlone`):

Query: _"verbose logging in aws s3 cp"_

| Method           | Top result                                                               | Correct? |
| ---------------- | ------------------------------------------------------------------------ | -------- |
| Vector only      | Server access logging docs (semantically similar but wrong)              | No       |
| Keyword only     | S3 cp --debug flag docs (keyword match but ranked low)                   | Partial  |
| **Hybrid (RRF)** | **S3 cp --debug flag docs** (appears in both lists, RRF boosts it to #1) | **Yes**  |

## LLM provider abstraction

Switch between providers by changing one env var. No code changes.

```bash
# Ollama (default — fully local, no API key)
LLM_PROVIDER=ollama LLM_MODEL=llama3.2

# Anthropic
LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-sonnet-4-20250514

# OpenAI
LLM_PROVIDER=openai LLM_API_KEY=sk-... LLM_MODEL=gpt-4o
```

All three implement the same `llm.Provider` interface with compile-time checks:

```go
type Provider interface {
    StreamCompletion(ctx context.Context, system, user string) <-chan StreamEvent
    Complete(ctx context.Context, system, user string) (string, error)
    Model() string
}
```

## Chunking strategy

Not naive fixed-size splitting. The hierarchical chunker walks the parsed HTML tree and applies type-aware strategies:

- **Prose** — sentence-boundary splitting with configurable overlap (default 512 tokens, 50 overlap)
- **Code blocks** — always atomic, never split mid-snippet. Classified as `code` or `config` (IAM policies, CloudFormation YAML, Terraform HCL detected via regex)
- **Tables** — kept whole if they fit; large tables split by row with header re-attached to each sub-chunk
- **Config examples** — atomic units with preceding prose context prepended (`Context: This policy grants...`)

Every chunk carries: section path (e.g., `S3 > Bucket Policies > IAM Conditions`), chunk type enum, token count, source document URL, service name.

## Retrieval recall

24 query/expected-chunk pairs tested against BGE embeddings. Measured recall@5:

```
tests/test_retrieval_recall.py — 24 queries across:
  - Exact service name matches ("S3 bucket policy" → S3 policy chunk)
  - Semantic matches ("how to restrict access" → IAM policy chunk)
  - Code/config queries ("CloudFormation VPC template" → CFN YAML chunk)
  - Cross-service queries ("Lambda connecting to RDS" → Lambda+RDS chunk)

Recall@5: 100% (24/24)
```

If this drops below 70%, something in chunking or embedding is broken. The test runs with `make test ARGS="-m slow"`.

## Pipeline idempotency

Running the pipeline twice does not duplicate data:

1. **Crawler level** — SHA-256 content hash stored in SQLite. Unchanged pages are skipped before parsing.
2. **Postgres level** — `get_document_hash(url)` checked before re-indexing. If the hash matches, the document is skipped entirely.
3. **Upsert pattern** — DELETE cascade + INSERT within a transaction. No stale chunks left behind.

## Production-grade details

- **Timeouts on every external call** — embed service: 10s, LLM: 120s, DB pool: configurable
- **Graceful degradation** — if embedding service is down, falls back to keyword-only search
- **Structured logging** — zerolog JSON with request ID threaded through every handler, retrieval, and LLM call
- **Health checks** — `/healthz` (liveness), `/readyz` (checks DB + embed service connectivity)
- **Per-IP rate limiting** — token bucket (default 10 req/s, burst 20) with background stale entry cleanup
- **Two-level LRU cache** — retrieval results + full answers, SHA-256 keyed on query + service filter, 15min TTL
- **Panic recovery** — Chi middleware catches panics, returns 500, logs stack trace
- **No credential leaks** — DSN logged without password, API keys never logged

## Project structure

```
cloudsearch/
├── src/ingestion/           # Python ingestion pipeline
│   ├── edgar/               # SEC EDGAR client, iXBRL+regex fact extractor, store, CLI, demo samples
│   ├── crawler/             # BFS crawler with rate limiting + state
│   ├── parser/              # HTML → ContentNode tree
│   ├── chunker/             # Hierarchical type-aware chunking
│   ├── embedder/            # BGE-large-en-v1.5 (sentence-transformers)
│   └── indexer/             # asyncpg → Postgres with pgvector
├── api/                     # Go API server
│   ├── cmd/server/          # Entry point, dependency wiring, graceful shutdown
│   └── internal/
│       ├── config/          # Env-based config (caarlos0/env)
│       ├── db/              # pgx pool + pgvector type registration
│       ├── models/          # DB structs + API DTOs
│       ├── embedding/       # HTTP client to Python sidecar
│       ├── retrieval/       # vector.go, keyword.go, reranker.go, hybrid.go
│       ├── llm/             # Provider interface + Anthropic, OpenAI, Ollama
│       ├── generator/       # RAG prompt assembly + citation extraction
│       ├── cache/           # Two-level expirable LRU
│       ├── ratelimit/       # Per-IP token bucket
│       ├── server/          # HTTP lifecycle, routes, middleware
│       └── handler/         # search, health, stats handlers
├── web/                     # Next.js app: search console, stats, /filings spider viewer
├── docs/EDGAR_SPIDER.md     # Data + API contract for the spider feature
├── tests/                   # Python tests (unit, Postgres-backed, 24 recall)
├── alembic/                 # Database migrations
├── docker-compose.yml       # Postgres + embed service + API
└── Makefile                 # All build/run/test targets
```

## Tests

```bash
# Go unit tests (33 tests, ~2s)
cd api && go test ./... -v

# Python unit + integration tests (36 tests, ~1.5s, needs Postgres)
make test

# Retrieval recall tests (24 queries, needs model download first time)
make test ARGS="-m slow"
```

## Makefile targets

```
make setup        # Create Python venv, install deps
make db-up        # Start Postgres (Docker)
make db-down      # Stop Postgres
make migrate      # Run alembic migrations
make ingest       # Run ingestion pipeline
make test         # Python tests
make lint         # Ruff check + format
make api-dev      # Run Go API server (go run)
make api-build    # Build Go binary
make api-test     # Go tests
make docker-up    # Full stack via Docker Compose (postgres, embed, api, web)
make docker-down  # Tear down
make edgar-seed   # Load synthetic 10-K samples for the spider
make edgar-ingest # Fetch real 10-Ks from EDGAR (SEC_USER_AGENT required)
make edgar-extract# Run the extractor on a local file (FILE=...)
make web-dev      # Next.js dev server
```

## Configuration

All via environment variables:

| Variable            | Default                 | Description                                  |
| ------------------- | ----------------------- | -------------------------------------------- |
| `SERVER_PORT`       | `8080`                  | API server port                              |
| `DB_HOST`           | `localhost`             | Postgres host                                |
| `DB_PORT`           | `5432`                  | Postgres port                                |
| `DB_USER`           | `cloudsearch`           | Postgres user                                |
| `DB_PASSWORD`       | `cloudsearch`           | Postgres password                            |
| `DB_NAME`           | `cloudsearch`           | Postgres database                            |
| `EMBED_SERVICE_URL` | `http://localhost:8081` | BGE embedding sidecar URL                    |
| `LLM_PROVIDER`      | `ollama`                | LLM backend: `ollama`, `anthropic`, `openai` |
| `LLM_MODEL`         | `llama3.2`              | Model name                                   |
| `LLM_API_KEY`       |                         | Required for anthropic/openai only           |
| `CACHE_MAX_ENTRIES` | `1000`                  | LRU cache size                               |
| `CACHE_TTL`         | `15m`                   | Cache entry TTL                              |
| `RATE_LIMIT_RPS`    | `10`                    | Requests per second per IP                   |
| `LOG_LEVEL`         | `info`                  | Log level (debug, info, warn, error)         |

## Scaling considerations (not implemented, documented for context)

- **Kafka between crawler and indexer** — decouple ingestion rate from indexing throughput. Overkill at current data volume.
- **Cross-encoder reranker** — replace RRF with a learned reranker for better precision. Current RRF is parameter-free and works well.
- **Horizontal API scaling** — the Go server is stateless (cache is in-process). Add Redis for shared cache + multiple replicas behind a load balancer.
- **Incremental re-indexing** — content hash diffing is implemented. Add a cron job or webhook listener for real-time doc change detection.
- **Multi-region** — Postgres read replicas + CDN for static assets. The embed sidecar would need GPU instances per region.
