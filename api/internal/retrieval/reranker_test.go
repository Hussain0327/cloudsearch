package retrieval

import (
	"math"
	"testing"

	"github.com/hussain/cloudsearch/api/internal/models"
)

func makeChunk(id int64, text string) models.ScoredChunk {
	return models.ScoredChunk{
		Chunk: models.Chunk{
			ID:   id,
			Text: text,
		},
		Document: models.Document{
			ID:          id,
			ServiceName: "test-service",
			Title:       "Test Doc " + text,
		},
	}
}

func TestFuseRRF_KnownRanklists(t *testing.T) {
	// vector = [A:1, B:2, C:3], keyword = [B:1, D:2, A:3]
	vectorResults := []models.ScoredChunk{
		makeChunk(1, "A"), // rank 1
		makeChunk(2, "B"), // rank 2
		makeChunk(3, "C"), // rank 3
	}
	keywordResults := []models.ScoredChunk{
		makeChunk(2, "B"), // rank 1
		makeChunk(4, "D"), // rank 2
		makeChunk(1, "A"), // rank 3
	}

	results := FuseRRF(vectorResults, keywordResults, 10)

	// Expected RRF scores (k=60):
	// B: 1/(60+2) + 1/(60+1) = 1/62 + 1/61
	// A: 1/(60+1) + 1/(60+3) = 1/61 + 1/63
	// C: 1/(60+3) = 1/63
	// D: 1/(60+2) = 1/62
	expectedB := 1.0/62.0 + 1.0/61.0
	expectedA := 1.0/61.0 + 1.0/63.0
	expectedC := 1.0 / 63.0
	expectedD := 1.0 / 62.0

	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}

	// B should rank highest (appears in both lists)
	if results[0].Chunk.ID != 2 {
		t.Errorf("expected B (id=2) to rank highest, got id=%d", results[0].Chunk.ID)
	}

	// A should rank second (also appears in both lists, but slightly lower combined score)
	if results[1].Chunk.ID != 1 {
		t.Errorf("expected A (id=1) to rank second, got id=%d", results[1].Chunk.ID)
	}

	// Verify exact RRF scores within floating point tolerance
	tolerance := 1e-10
	for _, r := range results {
		var expected float64
		switch r.Chunk.ID {
		case 2:
			expected = expectedB
		case 1:
			expected = expectedA
		case 3:
			expected = expectedC
		case 4:
			expected = expectedD
		}
		if math.Abs(r.Score-expected) > tolerance {
			t.Errorf("chunk id=%d: expected score %f, got %f", r.Chunk.ID, expected, r.Score)
		}
	}
}

func TestFuseRRF_Deduplication(t *testing.T) {
	// Same chunk ID in both lists should produce one output entry
	vectorResults := []models.ScoredChunk{makeChunk(10, "X")}
	keywordResults := []models.ScoredChunk{makeChunk(10, "X")}

	results := FuseRRF(vectorResults, keywordResults, 10)

	if len(results) != 1 {
		t.Fatalf("expected 1 deduplicated result, got %d", len(results))
	}

	if results[0].Chunk.ID != 10 {
		t.Errorf("expected chunk id=10, got id=%d", results[0].Chunk.ID)
	}

	// Score should be sum of both rank contributions
	expected := 1.0/float64(60+1) + 1.0/float64(60+1)
	if math.Abs(results[0].Score-expected) > 1e-10 {
		t.Errorf("expected fused score %f, got %f", expected, results[0].Score)
	}

	// Should have both VectorRank and KeywordRank set
	if results[0].VectorRank != 1 {
		t.Errorf("expected VectorRank=1, got %d", results[0].VectorRank)
	}
	if results[0].KeywordRank != 1 {
		t.Errorf("expected KeywordRank=1, got %d", results[0].KeywordRank)
	}
}

func TestFuseRRF_EmptyInputs(t *testing.T) {
	t.Run("both empty", func(t *testing.T) {
		results := FuseRRF(nil, nil, 10)
		if len(results) != 0 {
			t.Errorf("expected 0 results, got %d", len(results))
		}
	})

	t.Run("vector empty", func(t *testing.T) {
		keywordResults := []models.ScoredChunk{makeChunk(1, "A")}
		results := FuseRRF(nil, keywordResults, 10)
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		if results[0].Chunk.ID != 1 {
			t.Errorf("expected chunk id=1, got id=%d", results[0].Chunk.ID)
		}
	})

	t.Run("keyword empty", func(t *testing.T) {
		vectorResults := []models.ScoredChunk{makeChunk(1, "A")}
		results := FuseRRF(vectorResults, nil, 10)
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		if results[0].Chunk.ID != 1 {
			t.Errorf("expected chunk id=1, got id=%d", results[0].Chunk.ID)
		}
	})
}

func TestFuseRRF_TopKTruncation(t *testing.T) {
	vectorResults := []models.ScoredChunk{
		makeChunk(1, "A"),
		makeChunk(2, "B"),
		makeChunk(3, "C"),
	}
	keywordResults := []models.ScoredChunk{
		makeChunk(4, "D"),
		makeChunk(5, "E"),
	}

	results := FuseRRF(vectorResults, keywordResults, 2)

	if len(results) != 2 {
		t.Errorf("expected 2 results after topK truncation, got %d", len(results))
	}
}

func TestFuseRRF_TopKZeroReturnsAll(t *testing.T) {
	vectorResults := []models.ScoredChunk{
		makeChunk(1, "A"),
		makeChunk(2, "B"),
	}

	results := FuseRRF(vectorResults, nil, 0)

	if len(results) != 2 {
		t.Errorf("expected 2 results with topK=0 (no truncation), got %d", len(results))
	}
}

// TestFuseRRF_CaseStudy_HybridBeatsEitherAlone demonstrates a realistic scenario
// where vector-only search misses a CLI flag match and keyword-only search misses
// semantic similarity, but the fused hybrid result ranks the correct chunk highest.
//
// Scenario: User searches "how to enable verbose logging in aws s3 cp"
//
// The ideal answer chunk (id=42) contains: "Use the --debug flag with aws s3 cp
// to enable detailed logging output including HTTP request/response info."
//
// Vector search results (semantic similarity):
//   rank 1: id=100 "S3 logging overview: server-access logging and CloudTrail" (conceptually related to "logging" but wrong topic)
//   rank 2: id=42  "Use --debug flag with aws s3 cp..." (correct answer, but vector similarity slightly lower because text says "debug" not "verbose")
//   rank 3: id=101 "CloudWatch Logs integration for S3 bucket events" (semantically about logging, not the CLI)
//
// Keyword search results (BM25 on "verbose logging aws s3 cp"):
//   rank 1: id=42  "Use --debug flag with aws s3 cp..." (matches "aws", "s3", "cp", "logging")
//   rank 2: id=200 "aws s3 cp command reference: copies files" (matches "aws", "s3", "cp" but not about logging)
//   rank 3: id=201 "Verbose output in AWS CLI global options" (matches "verbose" and "aws" but not specific to s3 cp)
//
// Vector-only would return id=100 as top result (wrong).
// Keyword-only would return id=42 as top result (correct, but by luck of keyword overlap).
// RRF fusion: id=42 gets score from BOTH lists (vector rank 2 + keyword rank 1),
// making it the clear winner with a higher score than any single-list result.
func TestFuseRRF_CaseStudy_HybridBeatsEitherAlone(t *testing.T) {
	correctChunk := models.ScoredChunk{
		Chunk: models.Chunk{
			ID:          42,
			Text:        "Use the --debug flag with aws s3 cp to enable detailed logging output including HTTP request/response info.",
			SectionPath: "AWS CLI > S3 > Debugging",
		},
		Document: models.Document{
			ID:          10,
			ServiceName: "aws-cli",
			Title:       "AWS CLI S3 Commands",
			URL:         "https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html",
		},
	}

	// Vector results: the semantically similar but wrong chunk ranks first.
	// The correct chunk ranks second because "debug" != "verbose" reduces cosine similarity.
	vectorResults := []models.ScoredChunk{
		{
			Chunk: models.Chunk{
				ID:   100,
				Text: "S3 server-access logging captures detailed records for requests made to a bucket. CloudTrail logs API calls.",
			},
			Document: models.Document{
				ID:          20,
				ServiceName: "s3",
				Title:       "S3 Logging Overview",
				URL:         "https://docs.aws.amazon.com/s3/logging.html",
			},
		},
		correctChunk,
		{
			Chunk: models.Chunk{
				ID:   101,
				Text: "Use Amazon CloudWatch Logs to monitor and analyze S3 bucket events and access patterns.",
			},
			Document: models.Document{
				ID:          21,
				ServiceName: "cloudwatch",
				Title:       "CloudWatch Logs for S3",
				URL:         "https://docs.aws.amazon.com/cloudwatch/s3.html",
			},
		},
	}

	// Keyword results: BM25 correctly picks up "aws s3 cp" + "logging" keywords.
	keywordResults := []models.ScoredChunk{
		correctChunk,
		{
			Chunk: models.Chunk{
				ID:   200,
				Text: "The aws s3 cp command copies a local file or S3 object to another location locally or in S3.",
			},
			Document: models.Document{
				ID:          30,
				ServiceName: "aws-cli",
				Title:       "S3 CP Command Reference",
				URL:         "https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html",
			},
		},
		{
			Chunk: models.Chunk{
				ID:   201,
				Text: "Use --cli-verbose-output or --debug to see verbose output in any AWS CLI command.",
			},
			Document: models.Document{
				ID:          31,
				ServiceName: "aws-cli",
				Title:       "AWS CLI Global Options",
				URL:         "https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-options.html",
			},
		},
	}

	results := FuseRRF(vectorResults, keywordResults, 5)

	// The correct chunk (id=42) must rank highest in the fused results.
	if results[0].Chunk.ID != 42 {
		t.Errorf("expected correct chunk id=42 to rank highest in fused results, got id=%d", results[0].Chunk.ID)
	}

	// Verify that id=42 has a strictly higher score than id=100 (vector-only top result).
	var score42, score100 float64
	for _, r := range results {
		if r.Chunk.ID == 42 {
			score42 = r.Score
		}
		if r.Chunk.ID == 100 {
			score100 = r.Score
		}
	}
	if score42 <= score100 {
		t.Errorf("fused score for correct chunk (%.6f) should be > vector-only top result (%.6f)", score42, score100)
	}

	// Verify that id=42 appears in both lists (has both VectorRank and KeywordRank)
	if results[0].VectorRank == 0 || results[0].KeywordRank == 0 {
		t.Errorf("correct chunk should have both VectorRank (%d) and KeywordRank (%d) set",
			results[0].VectorRank, results[0].KeywordRank)
	}

	// Verify that id=100 (vector-only hit) only appears in vector results
	for _, r := range results {
		if r.Chunk.ID == 100 {
			if r.VectorRank == 0 {
				t.Error("id=100 should have VectorRank set")
			}
			if r.KeywordRank != 0 {
				t.Error("id=100 should NOT have KeywordRank set (it's not in keyword results)")
			}
		}
	}

	// Quantitative check: id=42 gets vector rank 2 + keyword rank 1
	// score = 1/(60+2) + 1/(60+1) = 1/62 + 1/61
	expectedScore42 := 1.0/62.0 + 1.0/61.0
	if math.Abs(score42-expectedScore42) > 1e-10 {
		t.Errorf("expected score for id=42: %f, got %f", expectedScore42, score42)
	}

	// id=100 gets only vector rank 1: score = 1/(60+1) = 1/61
	expectedScore100 := 1.0 / 61.0
	if math.Abs(score100-expectedScore100) > 1e-10 {
		t.Errorf("expected score for id=100: %f, got %f", expectedScore100, score100)
	}
}
