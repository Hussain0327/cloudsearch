package main

import (
	"context"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/hussain/cloudsearch/api/internal/cache"
	"github.com/hussain/cloudsearch/api/internal/config"
	"github.com/hussain/cloudsearch/api/internal/db"
	"github.com/hussain/cloudsearch/api/internal/embedding"
	"github.com/hussain/cloudsearch/api/internal/handler"
	"github.com/hussain/cloudsearch/api/internal/llm"
	"github.com/hussain/cloudsearch/api/internal/ratelimit"
	"github.com/hussain/cloudsearch/api/internal/retrieval"
	"github.com/hussain/cloudsearch/api/internal/server"
)

func main() {
	// Parse config
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	// Setup logger
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	log.Logger = zerolog.New(os.Stdout).With().Timestamp().Caller().Logger()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Database pool
	pool, err := db.NewPool(ctx, cfg.DSN(), cfg.DBPoolMin, cfg.DBPoolMax)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create database pool")
	}
	defer pool.Close()

	// Embedding client
	embedClient := embedding.NewClient(cfg.EmbedServiceURL)

	// LLM provider — switch via LLM_PROVIDER env var
	llmProvider := newLLMProvider(cfg)
	log.Info().Str("provider", cfg.LLMProvider).Str("model", llmProvider.Model()).Msg("LLM provider initialized")

	// Retrieval
	vectorSearcher := retrieval.NewVectorSearcher(pool)
	keywordSearcher := retrieval.NewKeywordSearcher(pool)
	hybridSearcher := retrieval.NewHybridSearcher(embedClient, vectorSearcher, keywordSearcher)

	// Cache
	appCache := cache.New(cfg.CacheMaxEntries, cfg.CacheTTL)

	// Rate limiter
	rl := ratelimit.New(cfg.RateLimitRPS, cfg.RateLimitBurst)
	defer rl.Close()

	// Handlers
	healthHandler := handler.NewHealthHandler(pool, embedClient)
	searchHandler := handler.NewSearchHandler(hybridSearcher, llmProvider, appCache)
	statsHandler := handler.NewStatsHandler(pool)

	// Server
	srv := server.New(cfg.ServerPort, healthHandler, searchHandler, statsHandler, rl)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.Start(); err != nil {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	log.Info().Int("port", cfg.ServerPort).Msg("server started")

	<-sigCh
	log.Info().Msg("received shutdown signal")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("shutdown error")
	}

	log.Info().Msg("server stopped")
}

func newLLMProvider(cfg *config.Config) llm.Provider {
	switch strings.ToLower(cfg.LLMProvider) {
	case "openai":
		if cfg.LLMModel == "claude-sonnet-4-20250514" {
			cfg.LLMModel = "gpt-4o" // sensible default for OpenAI
		}
		return llm.NewOpenAIProvider(cfg.LLMAPIKey, cfg.LLMModel, cfg.LLMBaseURL)
	case "ollama":
		return llm.NewOllamaProvider(cfg.LLMModel, cfg.LLMBaseURL)
	default: // "anthropic"
		if cfg.LLMAPIKey == "" {
			log.Fatal().Msg("LLM_API_KEY is required for Anthropic provider")
		}
		return llm.NewAnthropicProvider(cfg.LLMAPIKey, cfg.LLMModel)
	}
}
