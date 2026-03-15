package models

import "time"

// SearchRequest is the input DTO for POST /api/v1/search.
type SearchRequest struct {
	Query    string   `json:"query"`
	TopK     int      `json:"top_k,omitempty"`
	Services []string `json:"services,omitempty"`
	Stream   bool     `json:"stream,omitempty"`
}

// SearchResponse is the output DTO for non-streaming responses.
type SearchResponse struct {
	Answer   string           `json:"answer"`
	Citations []Citation      `json:"citations"`
	Metadata ResponseMetadata `json:"metadata"`
}

// Citation represents a source chunk referenced in the answer.
type Citation struct {
	ChunkID     int64   `json:"chunk_id"`
	DocumentURL string  `json:"document_url"`
	Title       string  `json:"title"`
	ServiceName string  `json:"service_name"`
	SectionPath string  `json:"section_path"`
	Text        string  `json:"text"`
	Score       float64 `json:"score"`
}

// ResponseMetadata contains timing and retrieval info.
type ResponseMetadata struct {
	QueryTimeMS    int64  `json:"query_time_ms"`
	ChunksFound    int    `json:"chunks_found"`
	CacheHit       bool   `json:"cache_hit"`
	Model          string `json:"model"`
}

// StatsResponse is the output DTO for GET /api/v1/stats.
type StatsResponse struct {
	TotalDocuments int64            `json:"total_documents"`
	TotalChunks    int64            `json:"total_chunks"`
	Services       []ServiceStats   `json:"services"`
	IndexedAt      time.Time        `json:"indexed_at"`
}

// ServiceStats contains per-service document/chunk counts.
type ServiceStats struct {
	ServiceName string `json:"service_name"`
	Documents   int64  `json:"documents"`
	Chunks      int64  `json:"chunks"`
}
