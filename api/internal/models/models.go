package models

import (
	"time"

	"github.com/pgvector/pgvector-go"
)

// ChunkType mirrors the PostgreSQL chunk_type enum.
type ChunkType string

const (
	ChunkTypeProse  ChunkType = "prose"
	ChunkTypeCode   ChunkType = "code"
	ChunkTypeTable  ChunkType = "table"
	ChunkTypeConfig ChunkType = "config"
)

// Document maps to the documents table.
type Document struct {
	ID          int64     `json:"id"`
	URL         string    `json:"url"`
	ServiceName string    `json:"service_name"`
	Title       string    `json:"title"`
	ContentHash string    `json:"content_hash"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Chunk maps to the chunks table.
type Chunk struct {
	ID          int64            `json:"id"`
	DocumentID  int64            `json:"document_id"`
	Text        string           `json:"text"`
	ChunkType   ChunkType        `json:"chunk_type"`
	SectionPath string           `json:"section_path"`
	TokenCount  int              `json:"token_count"`
	Metadata    map[string]any   `json:"metadata"`
	ChunkIndex  int              `json:"chunk_index"`
	Embedding   pgvector.Vector  `json:"-"`
}

// ScoredChunk is a Chunk with retrieval scoring metadata.
type ScoredChunk struct {
	Chunk
	Document    Document `json:"document"`
	Score       float64  `json:"score"`
	VectorRank  int      `json:"vector_rank,omitempty"`
	KeywordRank int      `json:"keyword_rank,omitempty"`
}
