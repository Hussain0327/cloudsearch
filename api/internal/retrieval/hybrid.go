package retrieval

import (
	"context"
	"fmt"
	"sync"

	"github.com/rs/zerolog"

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

	// Step 2: Fan out vector + keyword searches concurrently, isolating each
	// arm's failure. Both run against the original ctx (not a cancel-on-error
	// derived context) so one arm failing does not cancel the other. This
	// preserves graceful degradation: keyword-only when vector fails (e.g. a
	// pgvector dimension/index issue) and vector-only when keyword fails.
	var (
		vectorResults, keywordResults []models.ScoredChunk
		vectorErr, keywordErr         error
		wg                            sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		vectorResults, vectorErr = h.vectorSearch.Search(ctx, queryVec, retrieveK, services)
	}()
	go func() {
		defer wg.Done()
		keywordResults, keywordErr = h.keywordSearch.Search(ctx, query, retrieveK, services)
	}()
	wg.Wait()

	if vectorErr != nil {
		log.Warn().Err(vectorErr).Msg("vector search failed, degrading to keyword-only")
		vectorResults = nil
	}
	if keywordErr != nil {
		log.Warn().Err(keywordErr).Msg("keyword search failed, degrading to vector-only")
		keywordResults = nil
	}
	if vectorErr != nil && keywordErr != nil {
		return nil, fmt.Errorf("both vector and keyword search failed: vector=%v keyword=%v", vectorErr, keywordErr)
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
