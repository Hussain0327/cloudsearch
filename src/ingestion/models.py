"""Shared data models for the ingestion pipeline."""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np


class ContentNodeType(enum.Enum):
    SECTION = "section"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    CODE_BLOCK = "code_block"
    TABLE = "table"
    LIST = "list"
    ADMONITION = "admonition"


class ChunkType(enum.Enum):
    PROSE = "prose"
    CODE = "code"
    TABLE = "table"
    CONFIG = "config"


@dataclass
class CrawlResult:
    url: str
    html: str
    service_name: str
    crawled_at: datetime
    content_hash: str  # SHA-256 of html


@dataclass
class ContentNode:
    node_type: ContentNodeType
    text: str = ""
    children: list[ContentNode] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    # metadata can include: level (for headings), language (for code), title (for admonitions)


@dataclass
class Chunk:
    text: str
    chunk_type: ChunkType
    section_path: str  # e.g. "S3 > Bucket Policies > IAM Conditions"
    token_count: int
    metadata: dict = field(default_factory=dict)
    embedding: np.ndarray | None = None
