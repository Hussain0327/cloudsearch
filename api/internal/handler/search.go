package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/hussain/cloudsearch/api/internal/cache"
	"github.com/hussain/cloudsearch/api/internal/generator"
	"github.com/hussain/cloudsearch/api/internal/llm"
	"github.com/hussain/cloudsearch/api/internal/models"
	"github.com/hussain/cloudsearch/api/internal/retrieval"
)

// SearchHandler handles the main search endpoint.
type SearchHandler struct {
	searcher    *retrieval.HybridSearcher
	llmProvider llm.Provider
	cache       *cache.Cache
}

// NewSearchHandler creates a SearchHandler with all dependencies.
func NewSearchHandler(searcher *retrieval.HybridSearcher, provider llm.Provider, c *cache.Cache) *SearchHandler {
	return &SearchHandler{
		searcher:    searcher,
		llmProvider: provider,
		cache:       c,
	}
}

// Search handles POST /api/v1/search.
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)
	start := time.Now()

	var req models.SearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.Query) == "" {
		http.Error(w, `{"error":"query is required"}`, http.StatusBadRequest)
		return
	}

	if req.TopK <= 0 || req.TopK > 20 {
		req.TopK = 10
	}

	cacheKey := cache.Key(req.Query, req.Services)

	// Level 2: Check answer cache
	if cached, ok := h.cache.GetAnswer(cacheKey); ok {
		log.Info().Str("query", req.Query).Msg("answer cache hit")
		cached.Metadata.CacheHit = true
		cached.Metadata.QueryTimeMS = time.Since(start).Milliseconds()

		if req.Stream {
			h.streamCachedAnswer(w, cached)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.SearchResponse{
			Answer:    cached.Answer,
			Citations: cached.Citations,
			Metadata:  cached.Metadata,
		})
		return
	}

	// Level 1: Check retrieval cache or run hybrid search
	var chunks []models.ScoredChunk
	if cached, ok := h.cache.GetRetrieval(cacheKey); ok {
		log.Info().Str("query", req.Query).Msg("retrieval cache hit")
		chunks = cached.Chunks
	} else {
		var err error
		chunks, err = h.searcher.Search(ctx, req.Query, req.TopK, req.Services)
		if err != nil {
			log.Error().Err(err).Str("query", req.Query).Msg("hybrid search failed")
			http.Error(w, `{"error":"search failed"}`, http.StatusInternalServerError)
			return
		}
		h.cache.SetRetrieval(cacheKey, &cache.RetrievalEntry{
			Chunks:   chunks,
			CachedAt: time.Now(),
		})
	}

	// No results — tell the user clearly
	if len(chunks) == 0 {
		meta := models.ResponseMetadata{
			QueryTimeMS: time.Since(start).Milliseconds(),
			ChunksFound: 0,
			Model:       h.llmProvider.Model(),
		}
		noResultMsg := "I couldn't find any relevant documentation for your query. Try rephrasing or broadening your search terms."
		if req.Stream {
			sse := llm.NewSSEWriter(w)
			if sse == nil {
				http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
				return
			}
			sse.WriteChunk(noResultMsg)
			sse.WriteCitations([]models.Citation{})
			sse.WriteMetadata(meta)
			sse.WriteDone()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.SearchResponse{
			Answer:    noResultMsg,
			Citations: []models.Citation{},
			Metadata:  meta,
		})
		return
	}

	// Build RAG prompt
	systemPrompt, userPrompt := generator.BuildPrompt(req.Query, chunks)

	if req.Stream {
		h.streamResponse(w, r, systemPrompt, userPrompt, chunks, cacheKey, start)
	} else {
		h.jsonResponse(w, r, systemPrompt, userPrompt, chunks, cacheKey, start)
	}
}

func (h *SearchHandler) streamResponse(w http.ResponseWriter, r *http.Request, system, user string, chunks []models.ScoredChunk, cacheKey string, start time.Time) {
	log := zerolog.Ctx(r.Context())

	sse := llm.NewSSEWriter(w)
	if sse == nil {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	eventCh := h.llmProvider.StreamCompletion(r.Context(), system, user)

	var fullAnswer strings.Builder
	for event := range eventCh {
		switch event.Type {
		case "text":
			fullAnswer.WriteString(event.Text)
			if err := sse.WriteChunk(event.Text); err != nil {
				log.Error().Err(err).Msg("writing SSE chunk")
				return
			}
		case "error":
			log.Error().Err(event.Error).Msg("LLM stream error")
			sse.WriteError(event.Error.Error())
			return
		case "done":
			// handled after loop exits
		}
	}

	answer := fullAnswer.String()
	citations := generator.ExtractCitations(answer, chunks)
	meta := models.ResponseMetadata{
		QueryTimeMS: time.Since(start).Milliseconds(),
		ChunksFound: len(chunks),
		Model:       h.llmProvider.Model(),
	}

	sse.WriteCitations(citations)
	sse.WriteMetadata(meta)
	sse.WriteDone()

	// Cache the complete answer
	h.cache.SetAnswer(cacheKey, &cache.AnswerEntry{
		Answer:    answer,
		Citations: citations,
		Metadata:  meta,
		CachedAt:  time.Now(),
	})
}

func (h *SearchHandler) jsonResponse(w http.ResponseWriter, r *http.Request, system, user string, chunks []models.ScoredChunk, cacheKey string, start time.Time) {
	log := zerolog.Ctx(r.Context())

	answer, err := h.llmProvider.Complete(r.Context(), system, user)
	if err != nil {
		log.Error().Err(err).Msg("LLM completion failed")
		http.Error(w, `{"error":"generation failed"}`, http.StatusInternalServerError)
		return
	}

	citations := generator.ExtractCitations(answer, chunks)
	meta := models.ResponseMetadata{
		QueryTimeMS: time.Since(start).Milliseconds(),
		ChunksFound: len(chunks),
		Model:       h.llmProvider.Model(),
	}

	// Cache the complete answer
	h.cache.SetAnswer(cacheKey, &cache.AnswerEntry{
		Answer:    answer,
		Citations: citations,
		Metadata:  meta,
		CachedAt:  time.Now(),
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.SearchResponse{
		Answer:    answer,
		Citations: citations,
		Metadata:  meta,
	})
}

func (h *SearchHandler) streamCachedAnswer(w http.ResponseWriter, cached *cache.AnswerEntry) {
	sse := llm.NewSSEWriter(w)
	if sse == nil {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	sse.WriteChunk(cached.Answer)
	sse.WriteCitations(cached.Citations)
	sse.WriteMetadata(cached.Metadata)
	sse.WriteDone()
}
