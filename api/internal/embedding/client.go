package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/pgvector/pgvector-go"
)

// Client calls the Python embedding sidecar.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

type embedRequest struct {
	Text string `json:"text"`
}

type embedResponse struct {
	Embedding []float32 `json:"embedding"`
	Dimension int       `json:"dimension"`
}

// NewClient creates an embedding client targeting the sidecar at baseURL.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Embed sends a query to the sidecar and returns a pgvector.Vector.
func (c *Client) Embed(ctx context.Context, query string) (pgvector.Vector, error) {
	body, err := json.Marshal(embedRequest{Text: query})
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("marshaling embed request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/embed", bytes.NewReader(body))
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("calling embed service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return pgvector.Vector{}, fmt.Errorf("embed service returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Decode JSON — encoding/json decodes floats as float64, convert to float32
	var raw struct {
		Embedding []float64 `json:"embedding"`
		Dimension int       `json:"dimension"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return pgvector.Vector{}, fmt.Errorf("decoding embed response: %w", err)
	}

	vec := make([]float32, len(raw.Embedding))
	for i, v := range raw.Embedding {
		vec[i] = float32(v)
	}

	return pgvector.NewVector(vec), nil
}

// Health checks if the embedding sidecar is healthy.
func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("embed service health check failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("embed service unhealthy: status %d", resp.StatusCode)
	}
	return nil
}
