package generator

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hussain/cloudsearch/api/internal/models"
)

var citationRegex = regexp.MustCompile(`\[(\d+)\]`)

const systemPrompt = `You are CloudSearch, an AI assistant that answers questions about AWS documentation.
You have been provided with relevant documentation chunks retrieved from AWS docs.

INSTRUCTIONS:
- Answer the user's question using ONLY the provided context chunks.
- Cite your sources using bracket notation like [1], [2], etc., corresponding to the chunk numbers.
- If the context doesn't contain enough information to answer, say so clearly and state "I could not find a reliable answer for this in the retrieved documentation."
- Be concise and direct. Use code examples from the context when relevant.
- Format your response in Markdown.`

// BuildPrompt constructs the system and user prompts for RAG generation.
func BuildPrompt(query string, chunks []models.ScoredChunk) (system, user string) {
	var sb strings.Builder

	sb.WriteString("## Retrieved Context\n\n")
	for i, sc := range chunks {
		sb.WriteString(fmt.Sprintf("### [%d] %s — %s\n", i+1, sc.Document.ServiceName, sc.Document.Title))
		if sc.Chunk.SectionPath != "" {
			sb.WriteString(fmt.Sprintf("**Section:** %s\n", sc.Chunk.SectionPath))
		}
		sb.WriteString(fmt.Sprintf("**Source:** %s\n\n", sc.Document.URL))
		sb.WriteString(sc.Chunk.Text)
		sb.WriteString("\n\n---\n\n")
	}

	sb.WriteString(fmt.Sprintf("## Question\n\n%s", query))

	return systemPrompt, sb.String()
}

// ExtractCitations parses [N] references from the answer text and maps them to ScoredChunks.
// Always returns a non-nil slice (empty [] instead of null in JSON).
func ExtractCitations(answer string, chunks []models.ScoredChunk) []models.Citation {
	citations := make([]models.Citation, 0) // non-nil so JSON encodes as [] not null

	matches := citationRegex.FindAllStringSubmatch(answer, -1)
	if len(matches) == 0 {
		return citations
	}

	seen := make(map[int]bool)
	for _, match := range matches {
		num, err := strconv.Atoi(match[1])
		if err != nil || num < 1 || num > len(chunks) {
			continue
		}
		if seen[num] {
			continue
		}
		seen[num] = true

		sc := chunks[num-1]
		citations = append(citations, models.Citation{
			ChunkID:     sc.Chunk.ID,
			DocumentURL: sc.Document.URL,
			Title:       sc.Document.Title,
			ServiceName: sc.Document.ServiceName,
			SectionPath: sc.Chunk.SectionPath,
			Text:        truncateText(sc.Chunk.Text, 200),
			Score:       sc.Score,
		})
	}

	return citations
}

// truncateText truncates at a rune boundary to avoid breaking multi-byte UTF-8.
func truncateText(text string, maxRunes int) string {
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	runes := []rune(text)
	return string(runes[:maxRunes]) + "..."
}
