package llm

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// SSEWriter wraps an http.ResponseWriter for Server-Sent Events.
type SSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// NewSSEWriter prepares the response for SSE streaming.
// Returns nil if the ResponseWriter doesn't support flushing.
func NewSSEWriter(w http.ResponseWriter) *SSEWriter {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	return &SSEWriter{w: w, flusher: flusher}
}

// WriteChunk sends a text chunk event.
func (s *SSEWriter) WriteChunk(text string) error {
	return s.writeEvent("chunk", text)
}

// WriteCitations sends a citations event with JSON data.
func (s *SSEWriter) WriteCitations(data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshaling citations: %w", err)
	}
	return s.writeEvent("citations", string(jsonData))
}

// WriteMetadata sends a metadata event with JSON data.
func (s *SSEWriter) WriteMetadata(data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshaling metadata: %w", err)
	}
	return s.writeEvent("metadata", string(jsonData))
}

// WriteDone sends the stream termination event.
func (s *SSEWriter) WriteDone() error {
	return s.writeEvent("done", "")
}

// WriteError sends an error event.
func (s *SSEWriter) WriteError(msg string) error {
	return s.writeEvent("error", msg)
}

func (s *SSEWriter) writeEvent(event, data string) error {
	if _, err := fmt.Fprintf(s.w, "event: %s\n", event); err != nil {
		return err
	}
	if data != "" {
		if _, err := fmt.Fprintf(s.w, "data: %s\n", data); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprint(s.w, "\n"); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}
