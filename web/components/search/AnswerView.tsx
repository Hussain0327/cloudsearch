"use client";

import * as React from "react";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CitationChip } from "./CitationChip";
import { CodeBlock } from "./CodeBlock";

export interface AnswerViewProps {
  answer: string;
  citations: Citation[];
  /** True while tokens are still arriving — shows shimmer + blinking caret. */
  streaming?: boolean;
  /** 1-based citation index currently active (from card hover). */
  activeCite?: number | null;
  /** Click an inline [N] chip -> scroll/flash matching source card. */
  onActivateCite?: (index: number) => void;
  /** Hover/focus an inline chip -> highlight matching card. */
  onChipHover?: (index: number, hovering: boolean) => void;
}

/** A parsed markdown-lite block. */
type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; code: string; lang?: string }
  | { kind: "h"; level: number; text: string };

/**
 * Markdown-lite parser: fenced code, ATX headings, ordered/unordered lists, and
 * paragraphs separated by blank lines. Inline [N] is handled at render time.
 * Tolerates an unterminated trailing code fence (still streaming).
 */
function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split("\n");
  let i = 0;

  const flushPara = (buf: string[]) => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ kind: "p", text });
  };

  let para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(.*)$/);

    if (fence) {
      flushPara(para);
      para = [];
      const lang = fence[1].trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      // Skip the closing fence if present (may be absent mid-stream).
      if (i < lines.length) i++;
      blocks.push({ kind: "code", code: codeLines.join("\n"), lang });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(para);
      para = [];
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ulMatch || olMatch) {
      flushPara(para);
      para = [];
      const ordered = Boolean(olMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const u = lines[i].match(/^\s*[-*]\s+(.*)$/);
        const o = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered && o) items.push(o[1]);
        else if (!ordered && u) items.push(u[1]);
        else break;
        i++;
      }
      blocks.push(ordered ? { kind: "ol", items } : { kind: "ul", items });
      continue;
    }

    if (line.trim() === "") {
      flushPara(para);
      para = [];
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara(para);
  return blocks;
}

/**
 * Render a text run, splitting on [N] markers into interactive CitationChips.
 * Also applies minimal inline formatting for `inline code`.
 */
function renderInline(
  text: string,
  citations: Citation[],
  activeCite: number | null | undefined,
  onActivateCite: ((index: number) => void) | undefined,
  onChipHover: ((index: number, hovering: boolean) => void) | undefined,
  keyPrefix: string,
): React.ReactNode[] {
  // First split out inline code spans so [N] inside code isn't tokenized.
  const out: React.ReactNode[] = [];
  const codeSplit = text.split(/(`[^`]+`)/g);

  codeSplit.forEach((segment, si) => {
    if (segment.startsWith("`") && segment.endsWith("`") && segment.length >= 2) {
      out.push(
        <code
          key={`${keyPrefix}-code-${si}`}
          className="rounded-[2px] border border-hairline bg-raised px-1 py-px font-mono text-[0.85em] text-text-primary [font-feature-settings:'tnum'_1,'ss01'_1]"
        >
          {segment.slice(1, -1)}
        </code>,
      );
      return;
    }

    // Tokenize [N] markers.
    const parts = segment.split(/(\[\d+\])/g);
    parts.forEach((part, pi) => {
      const m = part.match(/^\[(\d+)\]$/);
      if (m) {
        const idx = Number(m[1]);
        const citation = citations[idx - 1] ?? null;
        out.push(
          <CitationChip
            key={`${keyPrefix}-cite-${si}-${pi}`}
            index={idx}
            citation={citation}
            active={activeCite === idx}
            onActivate={onActivateCite}
            onHoverChange={onChipHover}
          />,
        );
      } else if (part) {
        out.push(<React.Fragment key={`${keyPrefix}-t-${si}-${pi}`}>{part}</React.Fragment>);
      }
    });
  });

  return out;
}

export function AnswerView({
  answer,
  citations,
  streaming,
  activeCite,
  onActivateCite,
  onChipHover,
}: AnswerViewProps) {
  const blocks = React.useMemo(() => parseBlocks(answer), [answer]);
  const lastIdx = blocks.length - 1;

  return (
    <div className="prose-answer text-text-primary">
      {blocks.map((block, bi) => {
        const isLast = bi === lastIdx;
        const inline = (text: string) =>
          renderInline(text, citations, activeCite, onActivateCite, onChipHover, `b${bi}`);

        switch (block.kind) {
          case "code":
            return <CodeBlock key={bi} code={block.code} lang={block.lang} />;
          case "h": {
            const cls =
              block.level <= 1
                ? "text-h1 mt-5 mb-2"
                : block.level === 2
                  ? "text-h2 mt-4 mb-2"
                  : "text-[1rem] font-semibold mt-3 mb-1.5";
            return (
              <p key={bi} className={cls}>
                {inline(block.text)}
              </p>
            );
          }
          case "ul":
            return (
              <ul key={bi} className="my-2 list-disc space-y-1 pl-5">
                {block.items.map((it, ii) => (
                  <li key={ii}>{inline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={bi} className="my-2 list-decimal space-y-1 pl-5 [font-variant-numeric:tabular-nums]">
                {block.items.map((it, ii) => (
                  <li key={ii}>{inline(it)}</li>
                ))}
              </ol>
            );
          case "p":
          default:
            return (
              <p
                key={bi}
                className={cn(
                  "my-2 first:mt-0",
                  streaming && isLast && "relative",
                )}
              >
                {inline(block.text)}
                {streaming && isLast && (
                  <span
                    aria-hidden
                    className="caret-blink ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] bg-accent align-middle"
                  />
                )}
              </p>
            );
        }
      })}

      {/* Trailing caret when the answer ends on a non-paragraph block. */}
      {streaming && (lastIdx < 0 || blocks[lastIdx]?.kind !== "p") && (
        <span
          aria-hidden
          className="caret-blink inline-block h-[1.1em] w-[2px] translate-y-[0.15em] bg-accent align-middle"
        />
      )}

      {/* Streaming shimmer hint on the active token line. */}
      {streaming && (
        <span className="sr-only" aria-live="polite">
          Streaming answer…
        </span>
      )}
    </div>
  );
}
