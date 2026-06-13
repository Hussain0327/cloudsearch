# Migration runner image: applies Alembic migrations against the compose DB.
# Build context is the repo root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

# Alembic + a Postgres driver are all that's needed to run the migrations.
RUN pip install --no-cache-dir "alembic>=1.13,<2" "sqlalchemy>=2.0,<3" "psycopg2-binary>=2.9,<3"

# Migration scripts, config, and the ingestion package the env.py may import.
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY src ./src

ENV PYTHONPATH=/app/src

# DATABASE_URL (set in compose) overrides the alembic.ini sqlalchemy.url.
CMD ["alembic", "upgrade", "head"]
