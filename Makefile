VENV := .venv
BIN := $(VENV)/bin

.PHONY: setup db-up db-down migrate ingest test lint
.PHONY: api-dev api-build api-test docker-up docker-down
.PHONY: edgar-ingest edgar-seed edgar-extract web-dev

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
