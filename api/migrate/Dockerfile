# Migration runner image: applies Alembic migrations against the compose DB.
# Also used by the `edgar-seed` tool service (compose profile "tools"), so it
# carries the light runtime deps of the EDGAR extractor (no torch/model).
# Build context is the repo root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

# Alembic + a Postgres driver are all that's needed to run the migrations.
RUN pip install --no-cache-dir "alembic>=1.13,<2" "sqlalchemy>=2.0,<2.1" "psycopg2-binary>=2.9,<3" \
    "beautifulsoup4>=4.12,<5" "lxml>=5.1,<6" "asyncpg>=0.29,<1" "click>=8.1,<9" "structlog>=24.1,<26" \
    "aiohttp>=3.9,<4" "pydantic>=2.5,<3" "pydantic-settings>=2.1,<3"

# Migration scripts, config, and the ingestion package the env.py may import.
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY src ./src

ENV PYTHONPATH=/app/src

# DATABASE_URL (set in compose) overrides the alembic.ini sqlalchemy.url.
CMD ["alembic", "upgrade", "head"]
