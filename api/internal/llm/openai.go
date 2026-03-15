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

// OpenAIProvider implements Provider for the OpenAI Chat Completions API.
// Also compatible with any OpenAI-compatible API (e.g., Azure OpenAI).
type OpenAIProvider struct {
	apiKey     string
	model      string
	baseURL    string
	httpClient *http.Client
}

var _ Provider = (*OpenAIProvider)(nil)

func NewOpenAIProvider(apiKey, model, baseURL string) *OpenAIProvider {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAIProvider{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func (c *OpenAIProvider) Model() string { return c.model }

func (c *OpenAIProvider) StreamCompletion(ctx context.Context, system, user string) <-chan StreamEvent {
	ch := make(chan StreamEvent, 64)

	go func() {
		defer close(ch)

		messages := []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		}

		reqBody := map[string]any{
			"model":      c.model,
			"max_tokens": 4096,
			"stream":     true,
			"messages":   messages,
		}

		body, err := json.Marshal(reqBody)
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("marshaling request: %w", err)}
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
		if err != nil {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("creating request: %w", err)}
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)

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

		parseOpenAISSE(resp.Body, ch)
	}()

	return ch
}

func (c *OpenAIProvider) Complete(ctx context.Context, system, user string) (string, error) {
	messages := []map[string]string{
		{"role": "system", "content": system},
		{"role": "user", "content": user},
	}

	reqBody := map[string]any{
		"model":      c.model,
		"max_tokens": 4096,
		"messages":   messages,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

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
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}
	return result.Choices[0].Message.Content, nil
}

func parseOpenAISSE(body io.Reader, ch chan<- StreamEvent) {
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
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		if len(event.Choices) > 0 && event.Choices[0].Delta.Content != "" {
			ch <- StreamEvent{Type: "text", Text: event.Choices[0].Delta.Content}
		}
	}

	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("reading stream: %w", err)}
		return
	}
	ch <- StreamEvent{Type: "done"}
}
