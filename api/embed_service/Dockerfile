FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY api/embed_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy embedding service code
COPY api/embed_service/main.py .

# Bake the ingestion package into the image so it runs standalone (not only
# under docker-compose, which also bind-mounts ./src/ingestion for live edits).
COPY src/ingestion /app/src/ingestion

ENV PYTHONPATH=/app/src

# Persist the Hugging Face model cache to a mounted volume so the ~1.3GB BGE
# model is not re-downloaded on every container recreate.
ENV HF_HOME=/opt/hf-cache

EXPOSE 8081

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
