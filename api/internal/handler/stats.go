package handler

import (
	"encoding/json"
	"net/http"
	"time"

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

	resp := models.StatsResponse{
		TotalDocuments: totalDocs,
		TotalChunks:    totalChunks,
		Services:       services,
		IndexedAt:      time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
