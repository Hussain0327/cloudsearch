package retrieval

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"

	"github.com/hussain/cloudsearch/api/internal/embedding"
	"github.com/hussain/cloudsearch/api/internal/models"
)

// HybridSearcher orchestrates embedding, concurrent vector+keyword search, and RRF fusion.
// If the embedding service is unavailable, it falls back to keyword-only search.
type HybridSearcher struct {
	embedClient   *embedding.Client
	vectorSearch  *VectorSearcher
	keywordSearch *KeywordSearcher
}

func NewHybridSearcher(embedClient *embedding.Client, vs *VectorSearcher, ks *KeywordSearcher) *HybridSearcher {
	return &HybridSearcher{
		embedClient:   embedClient,
		vectorSearch:  vs,
		keywordSearch: ks,
	}
}

// Search runs the full hybrid retrieval pipeline:
// 1. Embed query via sidecar (with keyword-only fallback on failure)
// 2. Fan out vector + keyword searches concurrently
// 3. Fuse with RRF
// 4. Return top-K results
func (h *HybridSearcher) Search(ctx context.Context, query string, topK int, services []string) ([]models.ScoredChunk, error) {
	log := zerolog.Ctx(ctx)
	retrieveK := topK * 3

	// Step 1: Embed the query — fallback to keyword-only if embedding fails
	queryVec, embedErr := h.embedClient.Embed(ctx, query)
	if embedErr != nil {
		log.Warn().Err(embedErr).Msg("embedding failed, falling back to keyword-only search")

		keywordResults, err := h.keywordSearch.Search(ctx, query, retrieveK, services)
		if err != nil {
			return nil, fmt.Errorf("keyword fallback search: %w", err)
		}
		// Return keyword results directly (no fusion needed)
		if len(keywordResults) > topK {
			keywordResults = keywordResults[:topK]
		}
		log.Info().Int("keyword_hits", len(keywordResults)).Msg("keyword-only search complete (embedding unavailable)")
		return keywordResults, nil
	}

	// Step 2: Fan out vector + keyword searches
	var vectorResults, keywordResults []models.ScoredChunk

	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var err error
		vectorResults, err = h.vectorSearch.Search(gctx, queryVec, retrieveK, services)
		if err != nil {
			return fmt.Errorf("vector search: %w", err)
		}
		log.Debug().Int("count", len(vectorResults)).Msg("vector search complete")
		return nil
	})

	g.Go(func() error {
		var err error
		keywordResults, err = h.keywordSearch.Search(gctx, query, retrieveK, services)
		if err != nil {
			return fmt.Errorf("keyword search: %w", err)
		}
		log.Debug().Int("count", len(keywordResults)).Msg("keyword search complete")
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	// Step 3: Fuse with RRF and return top-K
	fused := FuseRRF(vectorResults, keywordResults, topK)
	log.Info().
		Int("vector_hits", len(vectorResults)).
		Int("keyword_hits", len(keywordResults)).
		Int("fused", len(fused)).
		Int("top_k", topK).
		Msg("hybrid search complete")

	return fused, nil
}
