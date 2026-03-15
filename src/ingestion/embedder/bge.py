"""BGE-large-en-v1.5 embedder via sentence-transformers."""

from __future__ import annotations

import numpy as np
import structlog

from ingestion.models import Chunk

log = structlog.get_logger()


class BGEEmbedder:
    def __init__(self, model_name: str = "BAAI/bge-large-en-v1.5", device: str | None = None):
        self.model_name = model_name
        self._model = None
        self._device = device

    def _load_model(self):
        if self._model is not None:
            return
        from sentence_transformers import SentenceTransformer

        log.info("loading_embedding_model", model=self.model_name)
        self._model = SentenceTransformer(self.model_name, device=self._device)
        log.info(
            "embedding_model_loaded",
            model=self.model_name,
            device=str(self._model.device),
            dim=self._model.get_sentence_embedding_dimension(),
        )

    @property
    def dimension(self) -> int:
        self._load_model()
        return self._model.get_sentence_embedding_dimension()

    def embed_chunks(self, chunks: list[Chunk], batch_size: int = 32) -> list[Chunk]:
        """Embed chunks in-place and return them. Synchronous (call from executor)."""
        if not chunks:
            return chunks

        self._load_model()
        texts = [c.text for c in chunks]

        log.info("embedding_chunks", count=len(texts), batch_size=batch_size)
        embeddings = self._model.encode(
            texts,
            batch_size=batch_size,
            normalize_embeddings=True,  # Required by BGE, enables inner product = cosine
            show_progress_bar=False,
        )

        for chunk, emb in zip(chunks, embeddings):
            chunk.embedding = np.array(emb, dtype=np.float32)

        log.info("embedding_complete", count=len(chunks))
        return chunks

    def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query with BGE instruction prefix."""
        self._load_model()
        # BGE requires instruction prefix for queries (not documents)
        prefixed = f"Represent this sentence for searching relevant passages: {query}"
        embedding = self._model.encode(
            [prefixed],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.array(embedding[0], dtype=np.float32)
