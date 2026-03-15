VENV := .venv
BIN := $(VENV)/bin

.PHONY: setup db-up db-down migrate ingest test lint
.PHONY: api-dev api-build api-test docker-up docker-down

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
