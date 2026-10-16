package server

import (
	"github.com/go-chi/chi/v5"

	"github.com/hussain/cloudsearch/api/internal/handler"
	"github.com/hussain/cloudsearch/api/internal/ratelimit"
)

// RegisterRoutes sets up all HTTP routes on the router.
func RegisterRoutes(
	r chi.Router,
	health *handler.HealthHandler,
	search *handler.SearchHandler,
	stats *handler.StatsHandler,
	filings *handler.FilingsHandler,
	rl *ratelimit.Limiter,
) {
	// Health checks (no rate limiting)
	r.Get("/healthz", health.Liveness)
	r.Get("/readyz", health.Readiness)

	// API v1 routes (rate limited)
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(rl.Middleware)
		r.Post("/search", search.Search)
		r.Get("/stats", stats.Stats)

		// EDGAR filings. The literal by-ticker route is registered before the
		// {id} pattern so chi never treats "by-ticker" as an id.
		r.Route("/filings", func(r chi.Router) {
			r.Get("/", filings.List)
			r.Get("/by-ticker/{ticker}", filings.GetByTicker)
			r.Get("/{id}", filings.Get)
			r.Get("/{id}/document", filings.Document)
			r.Get("/{id}/crawl", filings.Crawl)
		})
	})
}
