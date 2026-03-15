package server

import (
	"github.com/go-chi/chi/v5"

	"github.com/hussain/cloudsearch/api/internal/handler"
	"github.com/hussain/cloudsearch/api/internal/ratelimit"
)

// RegisterRoutes sets up all HTTP routes on the router.
func RegisterRoutes(r chi.Router, health *handler.HealthHandler, search *handler.SearchHandler, stats *handler.StatsHandler, rl *ratelimit.Limiter) {
	// Health checks (no rate limiting)
	r.Get("/healthz", health.Liveness)
	r.Get("/readyz", health.Readiness)

	// API v1 routes (rate limited)
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(rl.Middleware)
		r.Post("/search", search.Search)
		r.Get("/stats", stats.Stats)
	})
}
