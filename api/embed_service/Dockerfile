FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY api/embed_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy embedding service code
COPY api/embed_service/main.py .

# Ingestion package is mounted via docker-compose volume at /app/src/ingestion
# This allows reusing the exact BGEEmbedder from the Python pipeline

ENV PYTHONPATH=/app/src

EXPOSE 8081

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
