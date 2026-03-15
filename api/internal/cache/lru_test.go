package cache

import (
	"testing"
	"time"

	"github.com/hussain/cloudsearch/api/internal/models"
)

func TestKey_SameQueryAndServices_SameKey(t *testing.T) {
	k1 := Key("how to deploy", []string{"s3", "ec2"})
	k2 := Key("how to deploy", []string{"s3", "ec2"})

	if k1 != k2 {
		t.Errorf("same query+services should produce same key: %s != %s", k1, k2)
	}
}

func TestKey_DifferentQuery_DifferentKey(t *testing.T) {
	k1 := Key("how to deploy", []string{"s3"})
	k2 := Key("how to delete", []string{"s3"})

	if k1 == k2 {
		t.Error("different queries should produce different keys")
	}
}

func TestKey_DifferentServices_DifferentKey(t *testing.T) {
	k1 := Key("how to deploy", []string{"s3"})
	k2 := Key("how to deploy", []string{"ec2"})

	if k1 == k2 {
		t.Error("different services should produce different keys")
	}
}

func TestKey_CaseInsensitive(t *testing.T) {
	k1 := Key("How To Deploy", []string{"s3"})
	k2 := Key("how to deploy", []string{"s3"})

	if k1 != k2 {
		t.Errorf("key should be case-insensitive: %s != %s", k1, k2)
	}
}

func TestKey_SortsServices(t *testing.T) {
	k1 := Key("query", []string{"ec2", "s3", "lambda"})
	k2 := Key("query", []string{"lambda", "s3", "ec2"})

	if k1 != k2 {
		t.Errorf("key should sort services: %s != %s", k1, k2)
	}
}

func TestKey_DoesNotMutateInput(t *testing.T) {
	services := []string{"ec2", "s3", "lambda"}
	original := make([]string, len(services))
	copy(original, services)

	Key("query", services)

	for i, s := range services {
		if s != original[i] {
			t.Errorf("Key() mutated input slice: services[%d] = %q, want %q", i, s, original[i])
		}
	}
}

func TestGetAnswer_Miss(t *testing.T) {
	c := New(100, 5*time.Minute)

	entry, ok := c.GetAnswer("nonexistent-key")

	if ok {
		t.Error("expected cache miss, got hit")
	}
	if entry != nil {
		t.Error("expected nil entry on miss")
	}
}

func TestSetAndGetAnswer(t *testing.T) {
	c := New(100, 5*time.Minute)

	key := Key("test query", []string{"s3"})
	expected := &AnswerEntry{
		Answer: "The answer is 42.",
		Citations: []models.Citation{
			{ChunkID: 1, Title: "Test"},
		},
		Metadata: models.ResponseMetadata{
			QueryTimeMS: 150,
			ChunksFound: 5,
			Model:       "claude-3",
		},
		CachedAt: time.Now(),
	}

	c.SetAnswer(key, expected)

	entry, ok := c.GetAnswer(key)
	if !ok {
		t.Fatal("expected cache hit, got miss")
	}
	if entry.Answer != expected.Answer {
		t.Errorf("expected answer %q, got %q", expected.Answer, entry.Answer)
	}
	if len(entry.Citations) != 1 {
		t.Errorf("expected 1 citation, got %d", len(entry.Citations))
	}
	if entry.Metadata.Model != "claude-3" {
		t.Errorf("expected model 'claude-3', got %q", entry.Metadata.Model)
	}
}

func TestGetRetrieval_Miss(t *testing.T) {
	c := New(100, 5*time.Minute)

	entry, ok := c.GetRetrieval("nonexistent-key")

	if ok {
		t.Error("expected cache miss, got hit")
	}
	if entry != nil {
		t.Error("expected nil entry on miss")
	}
}

func TestSetAndGetRetrieval(t *testing.T) {
	c := New(100, 5*time.Minute)

	key := Key("search query", []string{"ec2"})
	expected := &RetrievalEntry{
		Chunks: []models.ScoredChunk{
			{
				Chunk: models.Chunk{
					ID:   1,
					Text: "EC2 instance types overview.",
				},
				Document: models.Document{
					ServiceName: "ec2",
					Title:       "Instance Types",
				},
				Score: 0.85,
			},
		},
		CachedAt: time.Now(),
	}

	c.SetRetrieval(key, expected)

	entry, ok := c.GetRetrieval(key)
	if !ok {
		t.Fatal("expected cache hit, got miss")
	}
	if len(entry.Chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(entry.Chunks))
	}
	if entry.Chunks[0].Chunk.ID != 1 {
		t.Errorf("expected chunk ID 1, got %d", entry.Chunks[0].Chunk.ID)
	}
	if entry.Chunks[0].Score != 0.85 {
		t.Errorf("expected score 0.85, got %f", entry.Chunks[0].Score)
	}
}

func TestAnswerAndRetrievalCachesAreIndependent(t *testing.T) {
	c := New(100, 5*time.Minute)
	key := "shared-key"

	c.SetAnswer(key, &AnswerEntry{Answer: "answer"})

	_, ok := c.GetRetrieval(key)
	if ok {
		t.Error("retrieval cache should not return answer cache entries")
	}

	c.SetRetrieval(key, &RetrievalEntry{
		Chunks: []models.ScoredChunk{{Chunk: models.Chunk{ID: 1}}},
	})

	_, ok = c.GetRetrieval(key)
	if !ok {
		t.Error("retrieval cache should return its own entries")
	}
}
