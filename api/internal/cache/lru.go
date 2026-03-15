package cache

import (
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
	"time"

	lru "github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/hussain/cloudsearch/api/internal/models"
)

// RetrievalEntry caches search results.
type RetrievalEntry struct {
	Chunks   []models.ScoredChunk
	CachedAt time.Time
}

// AnswerEntry caches a complete answer with citations.
type AnswerEntry struct {
	Answer    string
	Citations []models.Citation
	Metadata  models.ResponseMetadata
	CachedAt  time.Time
}

// Cache provides two-level LRU caching for retrieval results and full answers.
type Cache struct {
	retrieval *lru.LRU[string, *RetrievalEntry]
	answers   *lru.LRU[string, *AnswerEntry]
}

// New creates a two-level cache with the given size and TTL.
func New(maxEntries int, ttl time.Duration) *Cache {
	return &Cache{
		retrieval: lru.NewLRU[string, *RetrievalEntry](maxEntries, nil, ttl),
		answers:   lru.NewLRU[string, *AnswerEntry](maxEntries, nil, ttl),
	}
}

// GetRetrieval returns cached search results if present.
func (c *Cache) GetRetrieval(key string) (*RetrievalEntry, bool) {
	return c.retrieval.Get(key)
}

// SetRetrieval stores search results in the retrieval cache.
func (c *Cache) SetRetrieval(key string, entry *RetrievalEntry) {
	c.retrieval.Add(key, entry)
}

// GetAnswer returns a cached answer if present.
func (c *Cache) GetAnswer(key string) (*AnswerEntry, bool) {
	return c.answers.Get(key)
}

// SetAnswer stores a complete answer in the answer cache.
func (c *Cache) SetAnswer(key string, entry *AnswerEntry) {
	c.answers.Add(key, entry)
}

// Key generates a cache key from the query and service filter.
// Uses SHA-256 of lowercased query + sorted services.
func Key(query string, services []string) string {
	sorted := make([]string, len(services))
	copy(sorted, services)
	sort.Strings(sorted)

	raw := strings.ToLower(query) + "|" + strings.Join(sorted, ",")
	hash := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", hash)
}
