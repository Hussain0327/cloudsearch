package llm

import "testing"

// Compile-time interface checks: these lines will fail to compile if
// any of the provider types do not implement the Provider interface.
var _ Provider = (*AnthropicProvider)(nil)
var _ Provider = (*OpenAIProvider)(nil)
var _ Provider = (*OllamaProvider)(nil)

func TestAnthropicProvider_ImplementsProvider(t *testing.T) {
	// Verify via instantiation that AnthropicProvider satisfies Provider.
	var p Provider = NewAnthropicProvider("test-key", "claude-3-opus")
	if p.Model() != "claude-3-opus" {
		t.Errorf("expected model 'claude-3-opus', got %q", p.Model())
	}
}

func TestOpenAIProvider_ImplementsProvider(t *testing.T) {
	var p Provider = NewOpenAIProvider("test-key", "gpt-4", "")
	if p.Model() != "gpt-4" {
		t.Errorf("expected model 'gpt-4', got %q", p.Model())
	}
}

func TestOllamaProvider_ImplementsProvider(t *testing.T) {
	var p Provider = NewOllamaProvider("llama3", "")
	if p.Model() != "llama3" {
		t.Errorf("expected model 'llama3', got %q", p.Model())
	}
}
