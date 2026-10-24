VENV := .venv
BIN := $(VENV)/bin

.PHONY: setup db-up db-down migrate ingest test lint
.PHONY: api-dev api-build api-test docker-up docker-down
.PHONY: edgar-ingest edgar-seed edgar-extract web-dev
.PHONY: desktop-overlay desktop-build desktop-run desktop-app desktop-test

# === Python ingestion pipeline ===

setup:
	python3 -m venv $(VENV)
	$(BIN)/pip install -e ".[dev]"

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

migrate:
	$(BIN)/alembic upgrade head

ingest:
	$(BIN)/python -m ingestion ingest $(ARGS)

test:
	$(BIN)/pytest tests/ -v

lint:
	$(BIN)/ruff check src/ tests/
	$(BIN)/ruff format --check src/ tests/

# === Go API server ===

api-dev:
	cd api && go run ./cmd/server

api-build:
	cd api && go build -o bin/cloudsearch-api ./cmd/server

api-test:
	cd api && go test ./... -v

# === Docker ===

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

# === SEC EDGAR spider ===

edgar-ingest:   ## Fetch + extract + store real filings. Needs SEC_USER_AGENT="Name email". ARGS="--tickers AAPL MSFT"
	$(BIN)/python -m ingestion edgar ingest $(ARGS)

edgar-seed:     ## Load the bundled synthetic 10-K samples (offline demo data)
	$(BIN)/python -m ingestion edgar seed-demo

edgar-extract:  ## Run the extractor on a local filing: make edgar-extract FILE=path/to/10k.htm
	$(BIN)/python -m ingestion edgar extract-file $(FILE) $(ARGS)

web-dev:
	cd web && pnpm dev

# === Spider Desktop (native Mac app; see docs/DESKTOP_SPIDER.md) ===

desktop-overlay: ## Build the injected overlay and embed it in the Swift app
	cd desktop/overlay && pnpm install --frozen-lockfile && pnpm build

desktop-build: desktop-overlay ## Build the Mac app (release)
	cd desktop/SpiderDesktop && swift build -c release --product SpiderDesktop

desktop-run: desktop-build ## Build and launch the Mac app. ARGS="https://example.com"
	./desktop/SpiderDesktop/.build/release/SpiderDesktop $(ARGS)

desktop-app: desktop-build ## Wrap the binary in desktop/build/Spider.app
	desktop/scripts/bundle-app.sh

desktop-test: desktop-overlay ## Overlay unit tests + end-to-end self-test on the demo 10-K
	cd desktop/overlay && pnpm typecheck && pnpm test
	cd desktop/SpiderDesktop && swift build --product SpiderDesktop
	./desktop/SpiderDesktop/.build/debug/SpiderDesktop --self-test src/ingestion/edgar/demo/aapl_10k_sample.htm
	./desktop/SpiderDesktop/.build/debug/SpiderDesktop --self-test-text desktop/fixtures/capture_sample.txt
