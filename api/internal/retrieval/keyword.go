package retrieval

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hussain/cloudsearch/api/internal/models"
)

// KeywordSearcher runs full-text search using tsvector/tsquery.
type KeywordSearcher struct {
	pool *pgxpool.Pool
}

func NewKeywordSearcher(pool *pgxpool.Pool) *KeywordSearcher {
	return &KeywordSearcher{pool: pool}
}

// Search returns chunks matching the query text, ranked by ts_rank_cd.
func (s *KeywordSearcher) Search(ctx context.Context, queryText string, limit int, services []string) ([]models.ScoredChunk, error) {
	var query string
	var args []any

	if len(services) > 0 {
		query = `
			SELECT c.id, c.document_id, c.text, c.chunk_type, c.section_path,
			       c.token_count, c.metadata, c.chunk_index,
			       d.id, d.url, d.service_name, d.title, d.content_hash,
			       d.created_at, d.updated_at,
			       ts_rank_cd(c.search_vector, plainto_tsquery('english', $1)) AS score
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			WHERE c.search_vector @@ plainto_tsquery('english', $1)
			  AND d.service_name = ANY($3)
			ORDER BY score DESC
			LIMIT $2`
		args = []any{queryText, limit, services}
	} else {
		query = `
			SELECT c.id, c.document_id, c.text, c.chunk_type, c.section_path,
			       c.token_count, c.metadata, c.chunk_index,
			       d.id, d.url, d.service_name, d.title, d.content_hash,
			       d.created_at, d.updated_at,
			       ts_rank_cd(c.search_vector, plainto_tsquery('english', $1)) AS score
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			WHERE c.search_vector @@ plainto_tsquery('english', $1)
			ORDER BY score DESC
			LIMIT $2`
		args = []any{queryText, limit}
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("keyword search query: %w", err)
	}
	defer rows.Close()

	var results []models.ScoredChunk
	rank := 1
	for rows.Next() {
		var sc models.ScoredChunk
		var metaJSON []byte
		if err := rows.Scan(
			&sc.Chunk.ID, &sc.Chunk.DocumentID, &sc.Chunk.Text, &sc.Chunk.ChunkType,
			&sc.Chunk.SectionPath, &sc.Chunk.TokenCount, &metaJSON, &sc.Chunk.ChunkIndex,
			&sc.Document.ID, &sc.Document.URL, &sc.Document.ServiceName, &sc.Document.Title,
			&sc.Document.ContentHash, &sc.Document.CreatedAt, &sc.Document.UpdatedAt,
			&sc.Score,
		); err != nil {
			return nil, fmt.Errorf("scanning keyword result: %w", err)
		}
		if metaJSON != nil {
			_ = json.Unmarshal(metaJSON, &sc.Chunk.Metadata)
		}
		sc.KeywordRank = rank
		rank++
		results = append(results, sc)
	}

	return results, rows.Err()
}
