package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OllamaProvider implements Provider for the Ollama API (local models).
// Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint,
// but also has its own /api/chat endpoint. We use the native endpoint
// for better streaming support.
type OllamaProvider struct {
	model      string
	baseURL    string
	httpClient *http.Client
}

var _ Provider = (*OllamaProvider)(nil)

func NewOllamaProvider(model, baseURL string) *OllamaProvider {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	return &OllamaProvider{
		model:   model,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 300 * time.Second, // Local models can be slow
		},
	}
}

func (c *OllamaProvider) Model() string { return c.model }

func (c *OllamaProvider) StreamCompletion(ctx context.Context, system, user string) <-chan StreamEvent {
	ch := make(chan StreamEvent, 64)

	go func() {
		defer close(ch)

		reqBody := map[string]any{
			"model":  c.model,
			"stream": true,
			"messages": []map[string]string{
				{"role": "system", "content": system},
				{"role": "user", "content": user},
			},
		}

		body, err := json.Marshal(reqBody)
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("marshaling request: %w", err)}
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/chat", bytes.NewReader(body))
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("creating request: %w", err)}
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("API request failed: %w", err)}
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			respBody, _ := io.ReadAll(resp.Body)
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("API returned %d: %s", resp.StatusCode, string(respBody))}
			return
		}

		// Ollama streams newline-delimited JSON (not SSE)
		parseOllamaStream(resp.Body, ch)
	}()

	return ch
}

func (c *OllamaProvider) Complete(ctx context.Context, system, user string) (string, error) {
	reqBody := map[string]any{
		"model":  c.model,
		"stream": false,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	return result.Message.Content, nil
}

func parseOllamaStream(body io.Reader, ch chan<- StreamEvent) {
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		var event struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done bool `json:"done"`
		}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		if event.Message.Content != "" {
			ch <- StreamEvent{Type: "text", Text: event.Message.Content}
		}
		if event.Done {
			ch <- StreamEvent{Type: "done"}
			return
		}
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("reading stream: %w", err)}
		return
	}
	ch <- StreamEvent{Type: "done"}
}
