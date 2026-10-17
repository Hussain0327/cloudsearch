package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/hussain/cloudsearch/api/internal/models"
)

type StatsHandler struct {
	pool *pgxpool.Pool
}

func NewStatsHandler(pool *pgxpool.Pool) *StatsHandler {
	return &StatsHandler{pool: pool}
}

// Stats returns index statistics: total documents, chunks, and per-service breakdowns.
func (h *StatsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var totalDocs, totalChunks int64
	err := h.pool.QueryRow(ctx, "SELECT COUNT(*) FROM documents").Scan(&totalDocs)
	if err != nil {
		log.Error().Err(err).Msg("querying document count")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	err = h.pool.QueryRow(ctx, "SELECT COUNT(*) FROM chunks").Scan(&totalChunks)
	if err != nil {
		log.Error().Err(err).Msg("querying chunk count")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	rows, err := h.pool.Query(ctx, `
		SELECT d.service_name, COUNT(DISTINCT d.id), COUNT(c.id)
		FROM documents d
		LEFT JOIN chunks c ON c.document_id = d.id
		GROUP BY d.service_name
		ORDER BY d.service_name`)
	if err != nil {
		log.Error().Err(err).Msg("querying service stats")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var services []models.ServiceStats
	for rows.Next() {
		var s models.ServiceStats
		if err := rows.Scan(&s.ServiceName, &s.Documents, &s.Chunks); err != nil {
			log.Error().Err(err).Msg("scanning service stats")
			continue
		}
		services = append(services, s)
	}

	totalFilings := h.countOptional(ctx, "filings")
	totalFacts := h.countOptional(ctx, "facts")

	resp := models.StatsResponse{
		TotalDocuments: totalDocs,
		TotalChunks:    totalChunks,
		TotalFilings:   totalFilings,
		TotalFacts:     totalFacts,
		Services:       services,
		IndexedAt:      time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// countOptional counts rows in a table that may not exist yet (the filings
// migration is newer than the documents schema). A missing table (SQLSTATE
// 42P01 undefined_table) logs a warning and counts as 0 instead of failing the
// whole stats response.
func (h *StatsHandler) countOptional(ctx context.Context, table string) int64 {
	var n int64
	// table is one of two compile-time constants, never user input.
	err := h.pool.QueryRow(ctx, "SELECT COUNT(*) FROM "+table).Scan(&n)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
			log.Warn().Str("table", table).Msg("table not found; run alembic upgrade head")
			return 0
		}
		log.Error().Err(err).Str("table", table).Msg("counting rows")
		return 0
	}
	return n
}
