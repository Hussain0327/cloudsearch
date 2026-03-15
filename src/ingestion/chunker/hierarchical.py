"""Hierarchical tree-walking chunker with section path tracking."""

from __future__ import annotations

from ingestion.chunker.strategies import (
    CodeChunkStrategy,
    ProseChunkStrategy,
    TableChunkStrategy,
)
from ingestion.chunker.token_counter import count_tokens, truncate_to_tokens
from ingestion.models import Chunk, ContentNode, ContentNodeType


class HierarchicalChunker:
    def __init__(self, max_tokens: int = 512, overlap_tokens: int = 50):
        self.prose_strategy = ProseChunkStrategy(max_tokens=max_tokens)
        self.code_strategy = CodeChunkStrategy()
        self.table_strategy = TableChunkStrategy(max_tokens=max_tokens)
        self.overlap_tokens = overlap_tokens

    def chunk(self, root: ContentNode) -> list[Chunk]:
        """Walk the content tree and produce chunks with section path context."""
        chunks: list[Chunk] = []
        self._walk(root, heading_stack=[], chunks=chunks)
        self._apply_overlap(chunks)
        return chunks

    def _walk(
        self,
        node: ContentNode,
        heading_stack: list[tuple[str, int]],
        chunks: list[Chunk],
        last_paragraph_text: str = "",
    ) -> str:
        """Walk the tree, returning the last paragraph text seen for sibling context."""
        section_path = " > ".join(text for text, _ in heading_stack)

        match node.node_type:
            case ContentNodeType.SECTION:
                # Push heading onto stack with its level
                new_stack = heading_stack.copy()
                if node.text:
                    level = node.metadata.get("level", 0)
                    # Trim: remove entries at levels >= current heading
                    while new_stack and new_stack[-1][1] >= level and level > 0:
                        new_stack.pop()
                    new_stack.append((node.text, level))
                child_para_text = ""
                for child in node.children:
                    child_para_text = self._walk(child, new_stack, chunks, child_para_text)

            case ContentNodeType.PARAGRAPH:
                chunks.extend(self.prose_strategy.chunk(node.text, section_path))
                last_paragraph_text = node.text

            case ContentNodeType.LIST:
                # Treat lists as prose
                chunks.extend(self.prose_strategy.chunk(node.text, section_path))

            case ContentNodeType.ADMONITION:
                title = node.metadata.get("title", "Note")
                text = f"{title}: {node.text}"
                chunks.extend(self.prose_strategy.chunk(text, section_path))

            case ContentNodeType.CODE_BLOCK:
                language = node.metadata.get("language", "")
                code_chunks = self.code_strategy.chunk(node.text, section_path, language)
                # Prepend preceding paragraph context to code/config chunks
                if last_paragraph_text and code_chunks:
                    context_line = self._extract_context(last_paragraph_text)
                    if context_line:
                        for i, c in enumerate(code_chunks):
                            new_text = f"Context: {context_line}\n{c.text}"
                            code_chunks[i] = Chunk(
                                text=new_text,
                                chunk_type=c.chunk_type,
                                section_path=c.section_path,
                                token_count=count_tokens(new_text),
                                metadata=c.metadata,
                                embedding=c.embedding,
                            )
                chunks.extend(code_chunks)

            case ContentNodeType.TABLE:
                chunks.extend(self.table_strategy.chunk(node.text, section_path))

            case ContentNodeType.HEADING:
                # Headings are captured via SECTION nodes; standalone headings are no-ops
                pass

        return last_paragraph_text

    @staticmethod
    def _extract_context(paragraph_text: str, max_tokens: int = 100) -> str:
        """Extract the last sentence (or full text if short) from a paragraph, capped at max_tokens."""
        text = paragraph_text.strip()
        if not text:
            return ""

        # If the whole paragraph fits within the token budget, use it
        if count_tokens(text) <= max_tokens:
            return text

        # Otherwise, take the last sentence
        import re
        sentences = re.split(r"(?<=[.!?])\s+", text)
        last_sentence = sentences[-1].strip() if sentences else text

        if count_tokens(last_sentence) <= max_tokens:
            return last_sentence

        # Truncate to fit
        return truncate_to_tokens(last_sentence, max_tokens)

    def _apply_overlap(self, chunks: list[Chunk]) -> None:
        """Add overlap text between consecutive prose chunks in the same section."""
        if self.overlap_tokens <= 0:
            return

        for i in range(1, len(chunks)):
            prev = chunks[i - 1]
            curr = chunks[i]

            # Only overlap prose chunks in the same section
            if (
                prev.section_path != curr.section_path
                or prev.chunk_type != Chunk.__dataclass_fields__["chunk_type"].default  # noqa
            ):
                # Check both are prose
                if prev.chunk_type.value != "prose" or curr.chunk_type.value != "prose":
                    continue

            if prev.chunk_type.value != "prose" or curr.chunk_type.value != "prose":
                continue

            # Extract overlap from the end of the previous chunk
            overlap_text = truncate_to_tokens(prev.text, self.overlap_tokens)
            # Take the tail portion
            prev_text = prev.text
            if len(prev_text) > len(overlap_text):
                # Get last overlap_tokens worth of text
                tail = prev_text[len(prev_text) - len(overlap_text):]
            else:
                tail = prev_text

            # Prepend to current chunk (after section path header if present)
            if tail.strip():
                # Find end of section path header
                header_end = 0
                if curr.text.startswith("["):
                    bracket_close = curr.text.find("] ")
                    if bracket_close != -1:
                        header_end = bracket_close + 2

                header = curr.text[:header_end]
                body = curr.text[header_end:]
                new_text = header + "..." + tail.strip() + "... " + body
                chunks[i] = Chunk(
                    text=new_text,
                    chunk_type=curr.chunk_type,
                    section_path=curr.section_path,
                    token_count=count_tokens(new_text),
                    metadata=curr.metadata,
                    embedding=curr.embedding,
                )
