"""ContentNode tree utilities."""

from __future__ import annotations

from ingestion.models import ContentNode, ContentNodeType


def walk(node: ContentNode) -> list[ContentNode]:
    """Depth-first walk of the content tree, yielding all nodes."""
    result = [node]
    for child in node.children:
        result.extend(walk(child))
    return result


def pretty_print(node: ContentNode, indent: int = 0) -> str:
    """Debug-friendly tree representation."""
    prefix = "  " * indent
    text_preview = node.text[:60].replace("\n", "\\n") if node.text else ""
    lines = [f"{prefix}{node.node_type.value}: {text_preview}"]
    for child in node.children:
        lines.append(pretty_print(child, indent + 1))
    return "\n".join(lines)


def make_section(heading_text: str = "", level: int = 1) -> ContentNode:
    """Create a section node."""
    return ContentNode(
        node_type=ContentNodeType.SECTION,
        text=heading_text,
        metadata={"level": level},
    )
