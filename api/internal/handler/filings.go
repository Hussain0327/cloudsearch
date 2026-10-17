package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/hussain/cloudsearch/api/internal/filings"
	"github.com/hussain/cloudsearch/api/internal/llm"
	"github.com/hussain/cloudsearch/api/internal/models"
)

const (
	crawlDefaultPaceMS = 120
	crawlMaxPaceMS     = 5000
)

// FilingsHandler serves EDGAR filings, facts, documents, and the SSE crawl.
type FilingsHandler struct {
	store filings.Store
}

// NewFilingsHandler creates a FilingsHandler over the given store.
func NewFilingsHandler(store filings.Store) *FilingsHandler {
	return &FilingsHandler{store: store}
}

// List handles GET /api/v1/filings.
func (h *FilingsHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)

	list, err := h.store.ListFilings(ctx)
	if err != nil {
		log.Error().Err(err).Msg("listing filings")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, models.FilingsResponse{Filings: list})
}

// Get handles GET /api/v1/filings/{id}.
func (h *FilingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)

	id, ok := parseFilingID(w, r)
	if !ok {
		return
	}
	detail, err := h.store.GetFiling(ctx, id)
	if err != nil {
		if errors.Is(err, filings.ErrNotFound) {
			http.Error(w, `{"error":"filing not found"}`, http.StatusNotFound)
			return
		}
		log.Error().Err(err).Int64("filing_id", id).Msg("getting filing")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, detail)
}

// GetByTicker handles GET /api/v1/filings/by-ticker/{ticker}.
func (h *FilingsHandler) GetByTicker(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)

	ticker := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "ticker")))
	if ticker == "" {
		http.Error(w, `{"error":"ticker is required"}`, http.StatusBadRequest)
		return
	}
	detail, err := h.store.GetFilingByTicker(ctx, ticker)
	if err != nil {
		if errors.Is(err, filings.ErrNotFound) {
			http.Error(w, `{"error":"filing not found"}`, http.StatusNotFound)
			return
		}
		log.Error().Err(err).Str("ticker", ticker).Msg("getting filing by ticker")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, detail)
}

// Document handles GET /api/v1/filings/{id}/document and returns the
// annotated HTML with a restrictive CSP (the viewer injects it into its own
// DOM; the policy only matters if the URL is opened directly).
func (h *FilingsHandler) Document(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)

	id, ok := parseFilingID(w, r)
	if !ok {
		return
	}
	html, err := h.store.GetDocument(ctx, id)
	if err != nil {
		if errors.Is(err, filings.ErrNotFound) {
			http.Error(w, `{"error":"filing not found"}`, http.StatusNotFound)
			return
		}
		log.Error().Err(err).Int64("filing_id", id).Msg("getting filing document")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; img-src https://www.sec.gov data:; style-src 'unsafe-inline'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write([]byte(html))
}

// Crawl handles GET /api/v1/filings/{id}/crawl: a paced SSE replay of the
// filing's facts in document order (start, fact[, link]..., done).
func (h *FilingsHandler) Crawl(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := zerolog.Ctx(ctx)

	id, ok := parseFilingID(w, r)
	if !ok {
		return
	}

	q := r.URL.Query()

	pace := crawlDefaultPaceMS
	if v := q.Get("pace_ms"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			http.Error(w, `{"error":"pace_ms must be an integer"}`, http.StatusBadRequest)
			return
		}
		pace = n
	}
	if pace < 0 {
		pace = 0
	}
	if pace > crawlMaxPaceMS {
		pace = crawlMaxPaceMS
	}

	from := 0
	if v := q.Get("from"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			http.Error(w, `{"error":"from must be a non-negative integer"}`, http.StatusBadRequest)
			return
		}
		from = n
	}

	var categories map[string]bool
	if v := strings.TrimSpace(q.Get("categories")); v != "" {
		categories = make(map[string]bool)
		for _, c := range strings.Split(v, ",") {
			c = strings.ToLower(strings.TrimSpace(c))
			if c == "" {
				continue
			}
			if !models.FactCategories[c] {
				http.Error(w, `{"error":"unknown category: `+c+`"}`, http.StatusBadRequest)
				return
			}
			categories[c] = true
		}
		if len(categories) == 0 {
			categories = nil
		}
	}

	detail, err := h.store.GetFiling(ctx, id)
	if err != nil {
		if errors.Is(err, filings.ErrNotFound) {
			http.Error(w, `{"error":"filing not found"}`, http.StatusNotFound)
			return
		}
		log.Error().Err(err).Int64("filing_id", id).Msg("getting filing for crawl")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	// Select the facts this stream will emit.
	selected := make([]models.Fact, 0, len(detail.Facts))
	for _, f := range detail.Facts {
		if f.FactIndex < from {
			continue
		}
		if categories != nil && !categories[f.Category] {
			continue
		}
		selected = append(selected, f)
	}

	// Index links by fact_index so each follows its fact event.
	linksByIndex := make(map[int][]models.FilingLink, len(detail.Links))
	for _, l := range detail.Links {
		linksByIndex[l.FactIndex] = append(linksByIndex[l.FactIndex], l)
	}

	sse := llm.NewSSEWriter(w)
	if sse == nil {
		http.Error(w, `{"error":"streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	if err := sse.WriteEvent("start", models.CrawlStart{
		FilingID:    detail.Filing.ID,
		Ticker:      detail.Filing.Ticker,
		CompanyName: detail.Filing.CompanyName,
		Total:       detail.Filing.FactCount,
		Streaming:   len(selected),
	}); err != nil {
		return
	}

	var timer *time.Timer
	if pace > 0 {
		timer = time.NewTimer(time.Duration(pace) * time.Millisecond)
		defer timer.Stop()
	}

	for i, f := range selected {
		// Pace between facts (not before the first), stopping on disconnect.
		if i > 0 && pace > 0 {
			timer.Reset(time.Duration(pace) * time.Millisecond)
			select {
			case <-ctx.Done():
				log.Debug().Int64("filing_id", id).Int("sent", i).Msg("crawl client disconnected")
				return
			case <-timer.C:
			}
		} else if ctx.Err() != nil {
			return
		}

		if err := sse.WriteEvent("fact", f); err != nil {
			log.Debug().Err(err).Msg("writing crawl fact")
			return
		}
		for _, l := range linksByIndex[f.FactIndex] {
			if err := sse.WriteEvent("link", l); err != nil {
				return
			}
		}
	}

	_ = sse.WriteDone()
}

// parseFilingID reads {id} from the route, writing a 400 on a non-integer.
func parseFilingID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, `{"error":"invalid filing id"}`, http.StatusBadRequest)
		return 0, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
