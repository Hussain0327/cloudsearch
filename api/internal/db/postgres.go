package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

	// Verify pgvector is available BEFORE installing RegisterTypes. RegisterTypes
	// looks up the "vector" type OID at connection time; if the extension is
	// missing it fails inside AfterConnect with an opaque error. Probe with a
	// plain connection first so a missing extension produces a clear message.
	probe, err := pgx.ConnectConfig(ctx, cfg.ConnConfig)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	var extExists bool
	err = probe.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')").Scan(&extExists)
	probe.Close(ctx)
	if err != nil {
		return nil, fmt.Errorf("checking pgvector extension: %w", err)
	}
	if !extExists {
		return nil, fmt.Errorf("pgvector extension not found")
	}

	// Extension confirmed — now register the vector type on every new connection.
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

	return pool, nil
}
