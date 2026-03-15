"""AWS documentation HTML parser.

Converts AWS docs HTML into a ContentNode tree preserving document structure.
"""

from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup, NavigableString, Tag

from ingestion.models import ContentNode, ContentNodeType, CrawlResult
from ingestion.parser.base import BaseParser


# Selectors for finding the main content area, tried in order
_MAIN_CONTENT_SELECTORS = [
    "#main-col-body",
    ".awsdocs-container",
    "main[role='main']",
    "main",
    "#main-content",
    "article",
]

# Tags to strip entirely
_STRIP_TAGS = {"nav", "footer", "script", "style", "noscript", "svg", "iframe"}

# Classes that indicate non-content elements
_STRIP_CLASSES = {
    "awsdocs-nav",
    "awsdocs-sidebar",
    "awsdocs-breadcrumb",
    "awsdocs-page-header-container",
    "awsdocs-footer",
    "feedbackYesNoDiv",
    "page-loading-indicator",
    "awsui-app-layout__navigation",
    "awsui-app-layout__tools",
}

_HEADING_RE = re.compile(r"^h([1-6])$", re.IGNORECASE)


class AWSParser(BaseParser):
    def parse(self, crawl_result: CrawlResult) -> ContentNode:
        soup = BeautifulSoup(crawl_result.html, "lxml")
        main = self._find_main_content(soup)
        self._strip_chrome(main)

        title = self._extract_title(soup, main)
        root = ContentNode(
            node_type=ContentNodeType.SECTION,
            text=title,
            metadata={"level": 0, "url": crawl_result.url},
        )
        self._build_tree(main, root, current_level=0)
        return root

    def _find_main_content(self, soup: BeautifulSoup) -> Tag:
        for selector in _MAIN_CONTENT_SELECTORS:
            el = soup.select_one(selector)
            if el is not None:
                return el
        # Fallback to body
        return soup.body or soup

    def _strip_chrome(self, tag: Tag) -> None:
        # Remove non-content tags
        for strip_tag in _STRIP_TAGS:
            for el in tag.find_all(strip_tag):
                el.decompose()

        # Remove non-content classes
        for cls in _STRIP_CLASSES:
            for el in tag.find_all(class_=cls):
                el.decompose()

    def _extract_title(self, soup: BeautifulSoup, main: Tag) -> str:
        # Try <title> tag first
        title_tag = soup.find("title")
        if title_tag and title_tag.string:
            # AWS titles often have " - Amazon ..." suffix
            title = title_tag.string.strip()
            for sep in [" - Amazon", " - AWS", " — Amazon", " — AWS"]:
                if sep in title:
                    title = title[: title.index(sep)]
                    break
            return title.strip()

        # Fallback to first h1
        h1 = main.find("h1")
        if h1:
            return h1.get_text(strip=True)
        return ""

    def _build_tree(self, element: Tag, parent: ContentNode, current_level: int) -> None:
        for child in element.children:
            if isinstance(child, NavigableString):
                text = child.strip()
                if text:
                    # Append to last paragraph child or create new one
                    self._append_text(parent, text)
                continue

            if not isinstance(child, Tag):
                continue

            # Heading → new section (skip h1 since title is already in root)
            heading_match = _HEADING_RE.match(child.name)
            if heading_match:
                level = int(heading_match.group(1))
                if level == 1:
                    # h1 is already captured as the root title — skip
                    continue
                heading_text = child.get_text(strip=True)
                if not heading_text:
                    continue
                section = ContentNode(
                    node_type=ContentNodeType.SECTION,
                    text=heading_text,
                    metadata={"level": level},
                )
                self._attach_section(parent, section, level)
                continue

            # Code block: <pre>, <pre><code>, or <div class="code">
            if child.name == "pre" or (
                child.name == "div" and "code" in child.get("class", [])
            ):
                code_text = child.get_text()
                if code_text.strip():
                    language = self._detect_code_language(child, code_text)
                    node = ContentNode(
                        node_type=ContentNodeType.CODE_BLOCK,
                        text=code_text.strip(),
                        metadata={"language": language},
                    )
                    self._get_current_section(parent).children.append(node)
                continue

            # Table
            if child.name == "table":
                table_md = self._table_to_markdown(child)
                if table_md:
                    node = ContentNode(
                        node_type=ContentNodeType.TABLE,
                        text=table_md,
                    )
                    self._get_current_section(parent).children.append(node)
                continue

            # Admonition: AWS note/warning/important divs
            if child.name == "div" and self._is_admonition(child):
                title, body = self._parse_admonition(child)
                node = ContentNode(
                    node_type=ContentNodeType.ADMONITION,
                    text=body,
                    metadata={"title": title},
                )
                self._get_current_section(parent).children.append(node)
                continue

            # List
            if child.name in ("ul", "ol"):
                list_text = self._list_to_text(child)
                if list_text.strip():
                    node = ContentNode(
                        node_type=ContentNodeType.LIST,
                        text=list_text,
                    )
                    self._get_current_section(parent).children.append(node)
                continue

            # Paragraph
            if child.name == "p":
                text = child.get_text(strip=True)
                if text:
                    node = ContentNode(
                        node_type=ContentNodeType.PARAGRAPH,
                        text=text,
                    )
                    self._get_current_section(parent).children.append(node)
                continue

            # For other block-level elements (div, section, main, etc.), recurse
            if child.name in ("div", "section", "article", "main", "span", "a", "em", "strong", "b", "i"):
                self._build_tree(child, parent, current_level)

    def _attach_section(
        self, parent: ContentNode, section: ContentNode, level: int
    ) -> None:
        """Attach a new section at the correct nesting depth."""
        target = parent
        # Walk into the last child section chain to find proper parent
        while target.children:
            last = target.children[-1]
            if (
                last.node_type == ContentNodeType.SECTION
                and last.metadata.get("level", 0) < level
            ):
                target = last
            else:
                break
        target.children.append(section)

    def _get_current_section(self, parent: ContentNode) -> ContentNode:
        """Get the deepest current section for appending content."""
        target = parent
        while target.children:
            last = target.children[-1]
            if last.node_type == ContentNodeType.SECTION:
                target = last
            else:
                break
        return target

    def _append_text(self, parent: ContentNode, text: str) -> None:
        section = self._get_current_section(parent)
        if section.children and section.children[-1].node_type == ContentNodeType.PARAGRAPH:
            section.children[-1].text += " " + text
        else:
            section.children.append(
                ContentNode(node_type=ContentNodeType.PARAGRAPH, text=text)
            )

    def _detect_code_language(self, element: Tag, text: str) -> str:
        # Check class attributes on <code> child or <pre> itself
        code_el = element.find("code") or element
        classes = code_el.get("class", [])
        for cls in classes:
            if cls.startswith("language-") or cls.startswith("lang-"):
                return cls.split("-", 1)[1]
            # AWS uses classes like "programlisting-json"
            for lang in ("json", "yaml", "xml", "python", "bash", "shell", "java", "go"):
                if lang in cls.lower():
                    return lang

        # Content-based detection
        stripped = text.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                json.loads(stripped)
                return "json"
            except (json.JSONDecodeError, ValueError):
                pass

        if stripped.startswith("---") or re.match(r"^\w+:\s", stripped):
            return "yaml"

        if stripped.startswith("<?xml") or stripped.startswith("<"):
            if "</" in stripped:
                return "xml"

        if any(stripped.startswith(p) for p in ("$ ", "# ", "aws ", "sudo ")):
            return "bash"

        return ""

    def _table_to_markdown(self, table: Tag) -> str:
        rows: list[list[str]] = []
        for tr in table.find_all("tr"):
            cells = []
            for td in tr.find_all(["th", "td"]):
                cells.append(td.get_text(strip=True).replace("|", "\\|"))
            if cells:
                rows.append(cells)

        if not rows:
            return ""

        # Normalize column count
        max_cols = max(len(r) for r in rows)
        for row in rows:
            while len(row) < max_cols:
                row.append("")

        lines = []
        lines.append("| " + " | ".join(rows[0]) + " |")
        lines.append("| " + " | ".join("---" for _ in rows[0]) + " |")
        for row in rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)

    def _is_admonition(self, element: Tag) -> bool:
        classes = element.get("class", [])
        admonition_indicators = [
            "awsdocs-note",
            "awsdocs-warning",
            "awsdocs-important",
            "awsdocs-tip",
            "note",
            "warning",
            "important",
            "tip",
        ]
        return any(cls in admonition_indicators for cls in classes)

    def _parse_admonition(self, element: Tag) -> tuple[str, str]:
        title_el = element.find(class_=re.compile(r"title|heading", re.IGNORECASE))
        title = title_el.get_text(strip=True) if title_el else "Note"
        if title_el:
            title_el.decompose()
        body = element.get_text(strip=True)
        return title, body

    def _list_to_text(self, element: Tag, indent: int = 0) -> str:
        lines = []
        for i, li in enumerate(element.find_all("li", recursive=False)):
            prefix = "  " * indent + ("- " if element.name == "ul" else f"{i + 1}. ")
            # Get direct text, not nested list text
            text_parts = []
            for child in li.children:
                if isinstance(child, NavigableString):
                    t = child.strip()
                    if t:
                        text_parts.append(t)
                elif isinstance(child, Tag) and child.name not in ("ul", "ol"):
                    text_parts.append(child.get_text(strip=True))
            lines.append(prefix + " ".join(text_parts))
            # Handle nested lists
            for nested in li.find_all(["ul", "ol"], recursive=False):
                lines.append(self._list_to_text(nested, indent + 1))
        return "\n".join(lines)
