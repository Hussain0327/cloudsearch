"""Pipeline configuration via pydantic-settings."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class CrawlerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CRAWLER_")

    concurrency: int = Field(default=10, description="Number of concurrent crawler workers")
    rate_limit_rps: float = Field(default=1.0, description="Requests per second limit")
    state_db_path: str = Field(default="crawl_state.db", description="SQLite path for crawl state")
    request_timeout: int = Field(default=30, description="HTTP request timeout in seconds")


class ChunkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CHUNKER_")

    max_tokens: int = Field(default=512, description="Target max tokens per chunk")
    overlap_tokens: int = Field(default=50, description="Overlap tokens between prose chunks")


class EmbedderSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EMBEDDER_")

    model_name: str = Field(
        default="BAAI/bge-large-en-v1.5", description="Sentence-transformers model name"
    )
    batch_size: int = Field(default=32, description="Embedding batch size")
    device: str | None = Field(default=None, description="Device override (cuda/cpu/mps)")


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DB_")

    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    user: str = Field(default="cloudsearch")
    password: str = Field(default="cloudsearch")
    name: str = Field(default="cloudsearch")
    pool_min: int = Field(default=2)
    pool_max: int = Field(default=10)

    @property
    def dsn(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"


class PipelineSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    crawler: CrawlerSettings = Field(default_factory=CrawlerSettings)
    chunker: ChunkerSettings = Field(default_factory=ChunkerSettings)
    embedder: EmbedderSettings = Field(default_factory=EmbedderSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    embed_batch_size: int = Field(
        default=128, description="Number of chunks to accumulate before embedding"
    )
    log_level: str = Field(default="INFO")
