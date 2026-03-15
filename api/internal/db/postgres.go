package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
	pgxvector "github.com/pgvector/pgvector-go/pgx"
	"github.com/rs/zerolog/log"
)

// NewPool creates a pgx connection pool with pgvector type registration.
func NewPool(ctx context.Context, dsn string, minConns, maxConns int) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parsing pool config: %w", err)
	}

	cfg.MinConns = int32(minConns)
	cfg.MaxConns = int32(maxConns)

	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		return pgxvector.RegisterTypes(ctx, conn)
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("creating pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	// Log connection info without credentials
	log.Info().Str("host", cfg.ConnConfig.Host).Uint16("port", cfg.ConnConfig.Port).
		Str("database", cfg.ConnConfig.Database).Int("min", minConns).Int("max", maxConns).
		Msg("database pool connected")

	// Verify pgvector is available
	var extExists bool
	err = pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')").Scan(&extExists)
	if err != nil || !extExists {
		pool.Close()
		return nil, fmt.Errorf("pgvector extension not found")
	}

	// Suppress unused import
	_ = pgvector.NewVector(nil)

	return pool, nil
}
