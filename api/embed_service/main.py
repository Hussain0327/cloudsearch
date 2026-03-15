"""FastAPI sidecar wrapping the existing BGEEmbedder for Go API server."""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to path so we can import ingestion.embedder
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root / "src"))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ingestion.embedder.bge import BGEEmbedder

app = FastAPI(title="CloudSearch Embedding Service", version="1.0.0")

embedder = BGEEmbedder()


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    dimension: int


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    vec = embedder.embed_query(req.text)
    return EmbedResponse(
        embedding=vec.tolist(),
        dimension=len(vec),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
