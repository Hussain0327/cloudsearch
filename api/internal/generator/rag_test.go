package generator

import (
	"strings"
	"testing"

	"github.com/hussain/cloudsearch/api/internal/models"
)

func makeTestChunks(n int) []models.ScoredChunk {
	chunks := make([]models.ScoredChunk, n)
	for i := 0; i < n; i++ {
		chunks[i] = models.ScoredChunk{
			Chunk: models.Chunk{
				ID:          int64(i + 1),
				Text:        "Chunk text " + strings.Repeat("x", 50),
				SectionPath: "Section > Path",
			},
			Document: models.Document{
				ID:          int64(i + 1),
				URL:         "https://docs.example.com/page",
				ServiceName: "test-service",
				Title:       "Test Title",
			},
			Score: float64(n-i) * 0.1,
		}
	}
	return chunks
}

func TestExtractCitations_ValidReferences(t *testing.T) {
	chunks := makeTestChunks(5)
	answer := "Based on [1] and [3], the answer is clear. Also see [5]."

	citations := ExtractCitations(answer, chunks)

	if len(citations) != 3 {
		t.Fatalf("expected 3 citations, got %d", len(citations))
	}

	// Check that the correct chunk IDs are returned in order of appearance
	expectedIDs := []int64{1, 3, 5}
	for i, c := range citations {
		if c.ChunkID != expectedIDs[i] {
			t.Errorf("citation %d: expected chunk ID %d, got %d", i, expectedIDs[i], c.ChunkID)
		}
	}
}

func TestExtractCitations_OutOfBounds(t *testing.T) {
	chunks := makeTestChunks(5)

	t.Run("zero is ignored", func(t *testing.T) {
		answer := "See [0] for details."
		citations := ExtractCitations(answer, chunks)
		if len(citations) != 0 {
			t.Errorf("expected 0 citations for [0], got %d", len(citations))
		}
	})

	t.Run("beyond range is ignored", func(t *testing.T) {
		answer := "See [99] for details."
		citations := ExtractCitations(answer, chunks)
		if len(citations) != 0 {
			t.Errorf("expected 0 citations for [99], got %d", len(citations))
		}
	})

	t.Run("mixed valid and invalid", func(t *testing.T) {
		answer := "See [0], [1], [99], and [3]."
		citations := ExtractCitations(answer, chunks)
		if len(citations) != 2 {
			t.Fatalf("expected 2 valid citations, got %d", len(citations))
		}
		if citations[0].ChunkID != 1 {
			t.Errorf("first citation should be chunk 1, got %d", citations[0].ChunkID)
		}
		if citations[1].ChunkID != 3 {
			t.Errorf("second citation should be chunk 3, got %d", citations[1].ChunkID)
		}
	})
}

func TestExtractCitations_DuplicatesProduceOneEntry(t *testing.T) {
	chunks := makeTestChunks(3)
	answer := "As stated in [1], and reaffirmed in [1], the answer is X."

	citations := ExtractCitations(answer, chunks)

	if len(citations) != 1 {
		t.Fatalf("expected 1 citation (deduplicated), got %d", len(citations))
	}
	if citations[0].ChunkID != 1 {
		t.Errorf("expected chunk ID 1, got %d", citations[0].ChunkID)
	}
}

func TestExtractCitations_EmptyAnswerReturnsNonNilSlice(t *testing.T) {
	chunks := makeTestChunks(3)
	citations := ExtractCitations("", chunks)

	if citations == nil {
		t.Fatal("expected non-nil slice for empty answer, got nil")
	}
	if len(citations) != 0 {
		t.Errorf("expected empty slice, got %d citations", len(citations))
	}
}

func TestExtractCitations_NoCitationsReturnsNonNilSlice(t *testing.T) {
	chunks := makeTestChunks(3)
	citations := ExtractCitations("No citations here at all.", chunks)

	if citations == nil {
		t.Fatal("expected non-nil slice when no citations found, got nil")
	}
	if len(citations) != 0 {
		t.Errorf("expected empty slice, got %d citations", len(citations))
	}
}

func TestExtractCitations_FieldMapping(t *testing.T) {
	chunks := []models.ScoredChunk{
		{
			Chunk: models.Chunk{
				ID:          42,
				Text:        "Some detailed text about the feature.",
				SectionPath: "Guide > Features > Auth",
			},
			Document: models.Document{
				ID:          10,
				URL:         "https://docs.example.com/auth",
				ServiceName: "iam",
				Title:       "IAM Authentication Guide",
			},
			Score: 0.95,
		},
	}

	answer := "According to [1], you need to configure IAM."
	citations := ExtractCitations(answer, chunks)

	if len(citations) != 1 {
		t.Fatalf("expected 1 citation, got %d", len(citations))
	}

	c := citations[0]
	if c.ChunkID != 42 {
		t.Errorf("ChunkID: expected 42, got %d", c.ChunkID)
	}
	if c.DocumentURL != "https://docs.example.com/auth" {
		t.Errorf("DocumentURL: expected https://docs.example.com/auth, got %s", c.DocumentURL)
	}
	if c.Title != "IAM Authentication Guide" {
		t.Errorf("Title: expected 'IAM Authentication Guide', got %s", c.Title)
	}
	if c.ServiceName != "iam" {
		t.Errorf("ServiceName: expected 'iam', got %s", c.ServiceName)
	}
	if c.SectionPath != "Guide > Features > Auth" {
		t.Errorf("SectionPath: expected 'Guide > Features > Auth', got %s", c.SectionPath)
	}
	if c.Score != 0.95 {
		t.Errorf("Score: expected 0.95, got %f", c.Score)
	}
}

func TestTruncateText_ShortText(t *testing.T) {
	text := "short"
	result := truncateText(text, 200)
	if result != text {
		t.Errorf("expected unchanged text %q, got %q", text, result)
	}
}

func TestTruncateText_ExactLength(t *testing.T) {
	text := "12345"
	result := truncateText(text, 5)
	if result != text {
		t.Errorf("expected unchanged text %q, got %q", text, result)
	}
}

func TestTruncateText_Truncation(t *testing.T) {
	text := "Hello, World!"
	result := truncateText(text, 5)
	if result != "Hello..." {
		t.Errorf("expected 'Hello...', got %q", result)
	}
}

func TestTruncateText_MultiByte_UTF8(t *testing.T) {
	// Each of these characters is a multi-byte UTF-8 rune.
	// We want to verify truncation is rune-safe, not byte-safe.
	text := "こんにちは世界" // 7 runes, but 21 bytes
	result := truncateText(text, 3)

	expected := "こんに..."
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}

	// Verify we didn't break a multi-byte character midway
	for i := 0; i < len(result); {
		_, size := rune(result[i]), 0
		for result[i]>>uint(7-size)&1 == 1 {
			size++
		}
		if size == 0 {
			size = 1
		}
		i += size
	}
}

func TestTruncateText_Emoji(t *testing.T) {
	// Emoji are multi-byte: each is 4 bytes in UTF-8
	text := "Hello 🌍🌎🌏 World"
	result := truncateText(text, 9)
	// 9 runes: H, e, l, l, o, ' ', 🌍, 🌎, 🌏
	expected := "Hello 🌍🌎🌏..."
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestBuildPrompt_IncludesAllFields(t *testing.T) {
	chunks := []models.ScoredChunk{
		{
			Chunk: models.Chunk{
				ID:          1,
				Text:        "Use s3 cp to copy files.",
				SectionPath: "CLI > S3 > Copy",
			},
			Document: models.Document{
				ID:          10,
				URL:         "https://docs.aws.amazon.com/s3/cp",
				ServiceName: "aws-cli",
				Title:       "S3 Copy Command",
			},
		},
		{
			Chunk: models.Chunk{
				ID:   2,
				Text: "Bucket policies control access.",
				// No SectionPath
			},
			Document: models.Document{
				ID:          11,
				URL:         "https://docs.aws.amazon.com/s3/policy",
				ServiceName: "s3",
				Title:       "Bucket Policies",
			},
		},
	}

	system, user := BuildPrompt("how do I copy files to S3?", chunks)

	// System prompt should contain the role description
	if !strings.Contains(system, "CloudSearch") {
		t.Error("system prompt should contain 'CloudSearch'")
	}

	// User prompt should contain chunk fields
	if !strings.Contains(user, "aws-cli") {
		t.Error("user prompt should contain service name 'aws-cli'")
	}
	if !strings.Contains(user, "S3 Copy Command") {
		t.Error("user prompt should contain title 'S3 Copy Command'")
	}
	if !strings.Contains(user, "CLI > S3 > Copy") {
		t.Error("user prompt should contain section path 'CLI > S3 > Copy'")
	}
	if !strings.Contains(user, "https://docs.aws.amazon.com/s3/cp") {
		t.Error("user prompt should contain URL")
	}
	if !strings.Contains(user, "Use s3 cp to copy files.") {
		t.Error("user prompt should contain chunk text")
	}

	// Should include the query
	if !strings.Contains(user, "how do I copy files to S3?") {
		t.Error("user prompt should contain the original query")
	}

	// Second chunk should also be present
	if !strings.Contains(user, "Bucket Policies") {
		t.Error("user prompt should contain second chunk title")
	}
	if !strings.Contains(user, "s3") {
		t.Error("user prompt should contain second chunk service name")
	}

	// Chunk numbering: [1] and [2]
	if !strings.Contains(user, "[1]") {
		t.Error("user prompt should contain chunk number [1]")
	}
	if !strings.Contains(user, "[2]") {
		t.Error("user prompt should contain chunk number [2]")
	}
}

func TestBuildPrompt_SectionPathOmittedWhenEmpty(t *testing.T) {
	chunks := []models.ScoredChunk{
		{
			Chunk: models.Chunk{
				ID:   1,
				Text: "Some text",
				// SectionPath intentionally empty
			},
			Document: models.Document{
				ServiceName: "svc",
				Title:       "Title",
				URL:         "https://example.com",
			},
		},
	}

	_, user := BuildPrompt("query", chunks)

	if strings.Contains(user, "**Section:**") {
		t.Error("user prompt should NOT contain Section header when SectionPath is empty")
	}
}
