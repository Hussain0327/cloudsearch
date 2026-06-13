"""FastAPI sidecar wrapping the existing BGEEmbedder for Go API server."""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Add project root to path so we can import ingestion.embedder
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root / "src"))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ingestion.embedder.bge import BGEEmbedder

# Device is configurable via EMBED_DEVICE (e.g. "cpu", "cuda", "mps"). Default
# auto-select. On a single-GPU Mac where Ollama also uses Metal, pin this to
# "cpu" to avoid GPU contention that makes embeds slow enough to time out.
embedder = BGEEmbedder(device=os.getenv("EMBED_DEVICE") or None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Eagerly load the BGE model at startup so the first real request doesn't
    # pay the cold-start cost (which can exceed the Go embed client's 10s
    # timeout, causing it to fall back to keyword-only search). With the
    # lifespan API, uvicorn only begins serving after this returns — so once
    # /health responds, the model is resident and the service is truly ready.
    embedder.embed_query("warmup")
    yield


app = FastAPI(title="CloudSearch Embedding Service", version="1.0.0", lifespan=lifespan)


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
