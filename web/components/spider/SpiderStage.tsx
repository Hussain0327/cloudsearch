"use client";

import * as React from "react";
import type { Fact } from "@/lib/filings-types";
import {
  anchorPoint,
  findFactElement,
  prepareFilingHtml,
  scrollToWithin,
} from "@/lib/filing-dom";
import { Spider, type Point } from "./Spider";

export interface SpiderStageProps {
  /** Annotated filing HTML (full document or fragment). */
  html: string;
  /** Every fact found so far; each gets the hit highlight. */
  facts: readonly Fact[];
  /** The fact the spider should be standing on right now. */
  activeFact: Fact | null;
  /** True while the crawl is advancing. */
  playing: boolean;
  /** Auto-scroll the document to keep the spider in view. */
  follow: boolean;
}

/**
 * The paper: renders the annotated document and drives the spider overlay.
 * On each new active fact it locates `[data-fact-id]`, moves the spider to
 * the span's anchor, marks it hit, and (optionally) scrolls it into view.
 */
export function SpiderStage({ html, facts, activeFact, playing, follow }: SpiderStageProps) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [target, setTarget] = React.useState<Point | null>(null);
  const [trail, setTrail] = React.useState<Point[]>([]);
  const [idle, setIdle] = React.useState<Point>({ x: 450, y: 120 });
  const markedRef = React.useRef<Set<string>>(new Set());
  const currentRef = React.useRef<HTMLElement | null>(null);

  const prepared = React.useMemo(() => prepareFilingHtml(html), [html]);

  // Idle at the top centre of the paper once it has laid out.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // ResizeObserver delivers an initial observation asynchronously, so no
    // synchronous measure() call is needed here.
    const ro = new ResizeObserver(() =>
      setIdle({ x: el.clientWidth / 2, y: Math.min(140, el.clientHeight / 3) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [prepared]);

  // Highlight every fact we have; clear everything when the list resets.
  React.useEffect(() => {
    const root = stageRef.current;
    if (!root) return;
    if (facts.length === 0) {
      root.querySelectorAll(".cs-fact--hit").forEach((el) => {
        el.classList.remove("cs-fact--hit", "cs-fact--pulse", "cs-fact--current");
      });
      markedRef.current = new Set();
      currentRef.current = null;
      const raf = requestAnimationFrame(() => {
        setTrail([]);
        setTarget(null);
      });
      return () => cancelAnimationFrame(raf);
    }
    for (const f of facts) {
      if (markedRef.current.has(f.dom_id)) continue;
      markedRef.current.add(f.dom_id);
      const el = findFactElement(root, f.dom_id);
      if (!el) continue;
      el.classList.add("cs-fact--hit", "cs-fact--pulse");
      const clear = () => el.classList.remove("cs-fact--pulse");
      el.addEventListener("animationend", clear, { once: true });
      window.setTimeout(clear, 900);
    }
  }, [facts, prepared]);

  // Walk to the active fact.
  React.useEffect(() => {
    const root = stageRef.current;
    if (!root || !activeFact) return;
    const el = findFactElement(root, activeFact.dom_id);
    if (!el) return;

    currentRef.current?.classList.remove("cs-fact--current");
    el.classList.add("cs-fact--current");
    currentRef.current = el;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (follow) {
      // Scroll only the paper's own scroll container, never the window, so the
      // control strip above the paper stays put.
      scrollToWithin(el, reduce ? "auto" : "smooth");
    }
    const p = anchorPoint(el, root);
    setTarget(p);
    setTrail((t) => [...t.slice(-11), p]);
  }, [activeFact, follow, prepared]);

  return (
    <div ref={stageRef} className="relative">
      <DocumentHtml html={prepared} />
      <Spider target={target} idle={idle} active={playing} trail={trail} />
    </div>
  );
}

/**
 * The injected filing. Memoized so React never re-sets innerHTML (which would
 * wipe the hit classes we add imperatively) unless the HTML itself changes.
 */
const DocumentHtml = React.memo(function DocumentHtml({ html }: { html: string }) {
  const prop = React.useMemo(() => ({ __html: html }), [html]);
  return <div className="cs-doc" dangerouslySetInnerHTML={prop} />;
});
