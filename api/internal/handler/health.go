package handler

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hussain/cloudsearch/api/internal/embedding"
)

type HealthHandler struct {
	pool        *pgxpool.Pool
	embedClient *embedding.Client
}

func NewHealthHandler(pool *pgxpool.Pool, embedClient *embedding.Client) *HealthHandler {
	return &HealthHandler{pool: pool, embedClient: embedClient}
}

// Liveness always returns 200 — the process is alive.
func (h *HealthHandler) Liveness(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Readiness checks DB and embed service connectivity.
func (h *HealthHandler) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	checks := map[string]string{}

	if err := h.pool.Ping(ctx); err != nil {
		checks["database"] = err.Error()
	} else {
		checks["database"] = "ok"
	}

	if err := h.embedClient.Health(ctx); err != nil {
		checks["embed_service"] = err.Error()
	} else {
		checks["embed_service"] = "ok"
	}

	w.Header().Set("Content-Type", "application/json")
	if checks["database"] != "ok" || checks["embed_service"] != "ok" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(checks)
}
