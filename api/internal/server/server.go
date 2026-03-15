package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"

	"github.com/hussain/cloudsearch/api/internal/handler"
	"github.com/hussain/cloudsearch/api/internal/ratelimit"
)

// Server wraps the HTTP server with lifecycle management.
type Server struct {
	httpServer *http.Server
	router     chi.Router
}

// New creates a configured HTTP server.
func New(port int, health *handler.HealthHandler, search *handler.SearchHandler, stats *handler.StatsHandler, rl *ratelimit.Limiter) *Server {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(CORS)
	r.Use(RequestLogger)
	// Note: chi's middleware.Timeout is NOT applied globally because it
	// conflicts with SSE streaming (it installs http.TimeoutHandler which
	// corrupts the response after the deadline). Instead, non-streaming
	// routes apply their own deadline via context.

	// Register routes
	RegisterRoutes(r, health, search, stats, rl)

	return &Server{
		httpServer: &http.Server{
			Addr:         fmt.Sprintf(":%d", port),
			Handler:      r,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 120 * time.Second, // Long for SSE streams
			IdleTimeout:  60 * time.Second,
		},
		router: r,
	}
}

// Start begins listening for HTTP requests.
func (s *Server) Start() error {
	log.Info().Str("addr", s.httpServer.Addr).Msg("starting HTTP server")
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}
	return nil
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	log.Info().Msg("shutting down HTTP server")
	return s.httpServer.Shutdown(ctx)
}
