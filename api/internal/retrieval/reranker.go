package retrieval

import (
	"sort"

	"github.com/hussain/cloudsearch/api/internal/models"
)

const rrfK = 60 // Standard RRF constant

// FuseRRF performs Reciprocal Rank Fusion on vector and keyword result lists.
// score(d) = Σ 1/(k + rank) for each list where the document appears.
// Deduplicates by chunk ID and returns results sorted by fused score descending.
func FuseRRF(vectorResults, keywordResults []models.ScoredChunk, topK int) []models.ScoredChunk {
	type fusedEntry struct {
		chunk models.ScoredChunk
		score float64
	}

	seen := make(map[int64]*fusedEntry)

	for i, sc := range vectorResults {
		rank := i + 1
		rrfScore := 1.0 / float64(rrfK+rank)
		if entry, ok := seen[sc.Chunk.ID]; ok {
			entry.score += rrfScore
			entry.chunk.VectorRank = rank
		} else {
			sc.VectorRank = rank
			seen[sc.Chunk.ID] = &fusedEntry{chunk: sc, score: rrfScore}
		}
	}

	for i, sc := range keywordResults {
		rank := i + 1
		rrfScore := 1.0 / float64(rrfK+rank)
		if entry, ok := seen[sc.Chunk.ID]; ok {
			entry.score += rrfScore
			entry.chunk.KeywordRank = rank
		} else {
			sc.KeywordRank = rank
			seen[sc.Chunk.ID] = &fusedEntry{chunk: sc, score: rrfScore}
		}
	}

	results := make([]models.ScoredChunk, 0, len(seen))
	for _, entry := range seen {
		entry.chunk.Score = entry.score
		results = append(results, entry.chunk)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if topK > 0 && len(results) > topK {
		results = results[:topK]
	}

	return results
}
