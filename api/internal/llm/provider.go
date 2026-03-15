package llm

import "context"

// StreamEvent represents a piece of the LLM response stream.
type StreamEvent struct {
	Type  string // "text", "error", "done"
	Text  string
	Error error
}

// Provider abstracts LLM backends. Implementations exist for Anthropic, OpenAI, and Ollama.
// Switch providers via the LLM_PROVIDER env var.
type Provider interface {
	// StreamCompletion sends a streaming request and returns a channel of events.
	StreamCompletion(ctx context.Context, system, user string) <-chan StreamEvent

	// Complete sends a non-streaming request and returns the full text.
	Complete(ctx context.Context, system, user string) (string, error)

	// Model returns the model identifier.
	Model() string
}
