package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	// Server
	ServerPort int `env:"SERVER_PORT" envDefault:"8080"`

	// Database
	DBHost     string `env:"DB_HOST" envDefault:"localhost"`
	DBPort     int    `env:"DB_PORT" envDefault:"5432"`
	DBUser     string `env:"DB_USER" envDefault:"cloudsearch"`
	DBPassword string `env:"DB_PASSWORD" envDefault:"cloudsearch"`
	DBName     string `env:"DB_NAME" envDefault:"cloudsearch"`
	DBPoolMin  int    `env:"DB_POOL_MIN" envDefault:"2"`
	DBPoolMax  int    `env:"DB_POOL_MAX" envDefault:"10"`

	// Embedding sidecar
	EmbedServiceURL string `env:"EMBED_SERVICE_URL" envDefault:"http://localhost:8081"`

	// LLM — switch providers via LLM_PROVIDER: ollama (default), anthropic, openai
	LLMProvider string `env:"LLM_PROVIDER" envDefault:"ollama"`
	LLMAPIKey   string `env:"LLM_API_KEY" envDefault:""`
	LLMModel    string `env:"LLM_MODEL" envDefault:"llama3.2"`
	LLMBaseURL  string `env:"LLM_BASE_URL" envDefault:""`

	// Cache
	CacheMaxEntries int           `env:"CACHE_MAX_ENTRIES" envDefault:"1000"`
	CacheTTL        time.Duration `env:"CACHE_TTL" envDefault:"15m"`

	// Rate limiting
	RateLimitRPS   float64 `env:"RATE_LIMIT_RPS" envDefault:"10"`
	RateLimitBurst int     `env:"RATE_LIMIT_BURST" envDefault:"20"`

	// Log level
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
}

func (c *Config) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func Load() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return cfg, nil
}
