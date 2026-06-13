package retrieval

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"

	"github.com/hussain/cloudsearch/api/internal/models"
)

// VectorSearcher runs pgvector inner-product similarity search.
type VectorSearcher struct {
	pool *pgxpool.Pool
}

func NewVectorSearcher(pool *pgxpool.Pool) *VectorSearcher {
	return &VectorSearcher{pool: pool}
}

// Search returns the top-N chunks by vector similarity, optionally filtered by service names.
// Uses <#> (negative inner product) operator — lower is more similar.
func (s *VectorSearcher) Search(ctx context.Context, embedding pgvector.Vector, limit int, services []string) ([]models.ScoredChunk, error) {
	var query string
	var args []any

	if len(services) > 0 {
		query = `
			SELECT c.id, c.document_id, c.text, c.chunk_type, c.section_path,
			       c.token_count, c.metadata, c.chunk_index,
			       d.id, d.url, d.service_name, d.title, d.content_hash,
			       d.created_at, d.updated_at,
			       -(c.embedding <#> $1) AS score
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			WHERE d.service_name = ANY($3)
			ORDER BY c.embedding <#> $1
			LIMIT $2`
		args = []any{embedding, limit, services}
	} else {
		query = `
			SELECT c.id, c.document_id, c.text, c.chunk_type, c.section_path,
			       c.token_count, c.metadata, c.chunk_index,
			       d.id, d.url, d.service_name, d.title, d.content_hash,
			       d.created_at, d.updated_at,
			       -(c.embedding <#> $1) AS score
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			ORDER BY c.embedding <#> $1
			LIMIT $2`
		args = []any{embedding, limit}
	}

	// Run inside an explicit transaction so SET LOCAL GUCs scope to this query
	// only (a plain pool.Query auto-commits, making SET LOCAL a no-op) and
	// never leak to other pooled-connection users.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("vector search begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Ensure the HNSW dynamic candidate list is at least as large as the
	// requested LIMIT (default ef_search is 40); otherwise an over-fetch
	// (retrieveK up to 60) silently caps ANN recall. Add headroom for the
	// service-filtered case where post-index filtering further reduces rows.
	efSearch := limit
	if efSearch < 100 {
		efSearch = 100
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL hnsw.ef_search = %d", efSearch)); err != nil {
		return nil, fmt.Errorf("setting hnsw.ef_search: %w", err)
	}
	if len(services) > 0 {
		// With a WHERE filter, pgvector applies the predicate AFTER the index
		// returns candidates, which can yield far fewer rows than LIMIT.
		// Iterative scan keeps scanning the index until LIMIT is satisfied.
		if _, err := tx.Exec(ctx, "SET LOCAL hnsw.iterative_scan = 'strict_order'"); err != nil {
			return nil, fmt.Errorf("setting hnsw.iterative_scan: %w", err)
		}
	}

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vector search query: %w", err)
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
			return nil, fmt.Errorf("scanning vector result: %w", err)
		}
		if metaJSON != nil {
			_ = json.Unmarshal(metaJSON, &sc.Chunk.Metadata)
		}
		sc.VectorRank = rank
		rank++
		results = append(results, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("vector search commit: %w", err)
	}

	return results, nil
}
