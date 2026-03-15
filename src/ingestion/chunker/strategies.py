"""Chunking strategies for different content types."""

from __future__ import annotations

import re

from ingestion.chunker.token_counter import count_tokens
from ingestion.models import Chunk, ChunkType, ContentNode

# Patterns for config detection (IAM policies, CloudFormation, Terraform, etc.)
_CONFIG_PATTERNS = [
    r'"Effect"\s*:\s*"(Allow|Deny)"',  # IAM policy
    r'"AWSTemplateFormatVersion"',  # CloudFormation
    r'"Resources"\s*:\s*\{',  # CloudFormation
    r"resource\s+\"aws_",  # Terraform
    r"provider\s+\"aws\"",  # Terraform
    r"Type:\s+AWS::",  # CloudFormation YAML
]
_CONFIG_RE = re.compile("|".join(_CONFIG_PATTERNS), re.IGNORECASE)

# Sentence boundary pattern for prose splitting
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


class ProseChunkStrategy:
    def __init__(self, max_tokens: int = 512):
        self.max_tokens = max_tokens

    def chunk(self, text: str, section_path: str) -> list[Chunk]:
        if not text.strip():
            return []

        context_header = f"[{section_path}] " if section_path else ""
        header_tokens = count_tokens(context_header)
        available = self.max_tokens - header_tokens

        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text.strip()]

        chunks: list[Chunk] = []
        current_parts: list[str] = []
        current_tokens = 0

        for para in paragraphs:
            para_tokens = count_tokens(para)

            if para_tokens > available:
                # Flush current buffer
                if current_parts:
                    chunk_text = context_header + "\n\n".join(current_parts)
                    chunks.append(Chunk(
                        text=chunk_text,
                        chunk_type=ChunkType.PROSE,
                        section_path=section_path,
                        token_count=count_tokens(chunk_text),
                    ))
                    current_parts = []
                    current_tokens = 0

                # Split large paragraph by sentences
                sentences = _SENTENCE_RE.split(para)
                for sentence in sentences:
                    s_tokens = count_tokens(sentence)
                    if current_tokens + s_tokens > available and current_parts:
                        chunk_text = context_header + " ".join(current_parts)
                        chunks.append(Chunk(
                            text=chunk_text,
                            chunk_type=ChunkType.PROSE,
                            section_path=section_path,
                            token_count=count_tokens(chunk_text),
                        ))
                        current_parts = []
                        current_tokens = 0
                    current_parts.append(sentence)
                    current_tokens += s_tokens
                continue

            if current_tokens + para_tokens > available and current_parts:
                chunk_text = context_header + "\n\n".join(current_parts)
                chunks.append(Chunk(
                    text=chunk_text,
                    chunk_type=ChunkType.PROSE,
                    section_path=section_path,
                    token_count=count_tokens(chunk_text),
                ))
                current_parts = []
                current_tokens = 0

            current_parts.append(para)
            current_tokens += para_tokens

        # Flush remaining
        if current_parts:
            chunk_text = context_header + "\n\n".join(current_parts)
            chunks.append(Chunk(
                text=chunk_text,
                chunk_type=ChunkType.PROSE,
                section_path=section_path,
                token_count=count_tokens(chunk_text),
            ))

        return chunks


class CodeChunkStrategy:
    """Code blocks are atomic — never split."""

    def chunk(self, text: str, section_path: str, language: str = "") -> list[Chunk]:
        if not text.strip():
            return []

        chunk_type = ChunkType.CONFIG if _CONFIG_RE.search(text) else ChunkType.CODE

        # Wrap in markdown fences
        lang_tag = language or ""
        fenced = f"```{lang_tag}\n{text}\n```"

        context_header = f"[{section_path}] " if section_path else ""
        chunk_text = context_header + fenced

        return [Chunk(
            text=chunk_text,
            chunk_type=chunk_type,
            section_path=section_path,
            token_count=count_tokens(chunk_text),
            metadata={"language": language},
        )]


class TableChunkStrategy:
    def __init__(self, max_tokens: int = 512):
        self.max_tokens = max_tokens

    def chunk(self, text: str, section_path: str) -> list[Chunk]:
        if not text.strip():
            return []

        context_header = f"[{section_path}] " if section_path else ""
        full_text = context_header + text
        total_tokens = count_tokens(full_text)

        if total_tokens <= self.max_tokens:
            return [Chunk(
                text=full_text,
                chunk_type=ChunkType.TABLE,
                section_path=section_path,
                token_count=total_tokens,
            )]

        # Split by rows, preserving header
        lines = text.strip().split("\n")
        if len(lines) < 3:
            # Too small to split meaningfully
            return [Chunk(
                text=full_text,
                chunk_type=ChunkType.TABLE,
                section_path=section_path,
                token_count=total_tokens,
            )]

        header = lines[0]
        separator = lines[1]
        data_rows = lines[2:]

        header_text = f"{header}\n{separator}"
        header_tokens = count_tokens(context_header + header_text)
        available = self.max_tokens - header_tokens

        chunks: list[Chunk] = []
        current_rows: list[str] = []
        current_tokens = 0

        for row in data_rows:
            row_tokens = count_tokens(row + "\n")
            if current_tokens + row_tokens > available and current_rows:
                chunk_text = context_header + header_text + "\n" + "\n".join(current_rows)
                chunks.append(Chunk(
                    text=chunk_text,
                    chunk_type=ChunkType.TABLE,
                    section_path=section_path,
                    token_count=count_tokens(chunk_text),
                ))
                current_rows = []
                current_tokens = 0
            current_rows.append(row)
            current_tokens += row_tokens

        if current_rows:
            chunk_text = context_header + header_text + "\n" + "\n".join(current_rows)
            chunks.append(Chunk(
                text=chunk_text,
                chunk_type=ChunkType.TABLE,
                section_path=section_path,
                token_count=count_tokens(chunk_text),
            ))

        return chunks
