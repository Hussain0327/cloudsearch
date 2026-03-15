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

const anthropicAPIURL = "https://api.anthropic.com/v1/messages"

// AnthropicProvider implements Provider for the Anthropic Messages API.
type AnthropicProvider struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

// Compile-time interface check.
var _ Provider = (*AnthropicProvider)(nil)

func NewAnthropicProvider(apiKey, model string) *AnthropicProvider {
	return &AnthropicProvider{
		apiKey: apiKey,
		model:  model,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func (c *AnthropicProvider) Model() string { return c.model }

func (c *AnthropicProvider) StreamCompletion(ctx context.Context, system, user string) <-chan StreamEvent {
	ch := make(chan StreamEvent, 64)

	go func() {
		defer close(ch)

		reqBody := map[string]any{
			"model":      c.model,
			"max_tokens": 4096,
			"stream":     true,
			"system":     system,
			"messages": []map[string]string{
				{"role": "user", "content": user},
			},
		}

		body, err := json.Marshal(reqBody)
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("marshaling request: %w", err)}
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPIURL, bytes.NewReader(body))
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("creating request: %w", err)}
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Key", c.apiKey)
		req.Header.Set("Anthropic-Version", "2023-06-01")

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

		parseAnthropicSSE(resp.Body, ch)
	}()

	return ch
}

func (c *AnthropicProvider) Complete(ctx context.Context, system, user string) (string, error) {
	reqBody := map[string]any{
		"model":      c.model,
		"max_tokens": 4096,
		"system":     system,
		"messages": []map[string]string{
			{"role": "user", "content": user},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPIURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Anthropic-Version", "2023-06-01")

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
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	var sb strings.Builder
	for _, block := range result.Content {
		sb.WriteString(block.Text)
	}
	return sb.String(), nil
}

func parseAnthropicSSE(body io.Reader, ch chan<- StreamEvent) {
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := scanner.Text()

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			ch <- StreamEvent{Type: "done"}
			return
		}

		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_delta":
			if event.Delta.Type == "text_delta" && event.Delta.Text != "" {
				ch <- StreamEvent{Type: "text", Text: event.Delta.Text}
			}
		case "message_stop":
			ch <- StreamEvent{Type: "done"}
			return
		case "error":
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("stream error: %s", data)}
			return
		}
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("reading stream: %w", err)}
	}
}
