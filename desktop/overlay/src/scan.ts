/**
 * Walks the page's text, runs the detectors, and wraps every match in a
 * `span.cs-fact` so the spider has somewhere to stand. Spans only ever wrap
 * part of one text node, so page layout is left alone.
 */

import {
  categoryFor,
  compileDetectors,
  findMatches,
  type CompiledDetector,
  type DetectorConfig,
  type Match,
} from './detectors';
import {clipContext, labelForMatch} from './label';
import type {Fact} from './types';

export const FACT_CLASS = 'cs-fact';
export const DEFAULT_MAX_FACTS = 400;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_ELEMENT_AND_TEXT = 0x1 | 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;

/** Text under these elements is never scanned. */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'svg',
  'head', 'title', 'ix:header', 'ix:hidden',
]);

/** Candidates for the "sentence" a figure sits in. */
const BLOCK_TAGS = new Set([
  'p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt', 'caption',
  'figcaption', 'blockquote', 'pre', 'div', 'section', 'article', 'body',
]);

/** A block longer than this is a page container, not a sentence. */
const MAX_BLOCK_CHARS = 2000;

export interface ScanOptions {
  readonly maxFacts?: number;
  /** The id of the overlay's own root element, which is never scanned. */
  readonly skipRootId?: string;
}

export interface ScanResult {
  readonly facts: Fact[];
  readonly truncated: boolean;
  readonly error?: string;
}

export function factId(index: number): string {
  return `f-${String(index).padStart(5, '0')}`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isVisible(element: Element): boolean {
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

function collectTextNodes(doc: Document, root: Element, skipRootId?: string): Text[] {
  const walker = doc.createTreeWalker(root, SHOW_ELEMENT_AND_TEXT, {
    acceptNode(node: Node): number {
      if (node.nodeType === ELEMENT_NODE) {
        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag) || element.classList.contains(FACT_CLASS)) {
          return FILTER_REJECT;
        }
        if (skipRootId !== undefined && element.id === skipRootId) {
          return FILTER_REJECT;
        }
        return FILTER_SKIP;
      }
      return node.nodeType === TEXT_NODE ? FILTER_ACCEPT : FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

/**
 * The nearest block ancestor short enough to read as a sentence, or null when
 * even the immediate parent is a page-sized container.
 */
function contextBlock(start: Element, lengths: WeakMap<Element, number>): Element | null {
  const lengthOf = (element: Element): number => {
    const cached = lengths.get(element);
    if (cached !== undefined) {
      return cached;
    }
    const length = (element.textContent ?? '').length;
    lengths.set(element, length);
    return length;
  };
  for (let element: Element | null = start; element !== null; element = element.parentElement) {
    if (!BLOCK_TAGS.has(element.tagName.toLowerCase())) {
      continue;
    }
    if (lengthOf(element) <= MAX_BLOCK_CHARS) {
      return element;
    }
    break;
  }
  return lengthOf(start) <= MAX_BLOCK_CHARS ? start : null;
}

/** Character offset of `target` within the text of `block`. */
function offsetWithin(doc: Document, block: Element, target: Text): number {
  const walker = doc.createTreeWalker(block, 0x4);
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node === target) {
      return offset;
    }
    offset += (node as Text).data.length;
  }
  return 0;
}

function wrap(doc: Document, node: Text, start: number, end: number, fact: Fact): Text {
  const target = node.splitText(start);
  const rest = target.splitText(end - start);
  const span = doc.createElement('span');
  span.className = FACT_CLASS;
  span.setAttribute('data-fact-id', fact.id);
  span.setAttribute('data-category', fact.category);
  span.setAttribute('data-kind', fact.kind);
  target.parentNode?.insertBefore(span, target);
  span.appendChild(target);
  return rest;
}

function buildFact(index: number, match: Match, context: string): Fact {
  const text = collapseWhitespace(match.text);
  return {
    index,
    id: factId(index),
    category: categoryFor(match, context),
    kind: match.kind,
    text,
    label: match.label ?? labelForMatch(context, text),
    value: match.value,
    unit: match.unit,
    context,
  };
}

function scanNode(
  doc: Document,
  node: Text,
  detectors: readonly CompiledDetector[],
  lengths: WeakMap<Element, number>,
  facts: Fact[],
  maxFacts: number,
): boolean {
  const matches = findMatches(node.data, detectors);
  if (matches.length === 0) {
    return false;
  }
  const parent = node.parentElement;
  if (parent === null || !isVisible(parent)) {
    return false;
  }
  const block = contextBlock(parent, lengths);
  const blockText = block === null ? node.data : (block.textContent ?? '');
  const nodeOffset = block === null ? 0 : offsetWithin(doc, block, node);
  let current = node;
  let consumed = 0;
  for (const match of matches) {
    if (facts.length >= maxFacts) {
      return true;
    }
    const context = clipContext(blockText, nodeOffset + match.start, match.end - match.start);
    const fact = buildFact(facts.length, match, context);
    current = wrap(doc, current, match.start - consumed, match.end - consumed, fact);
    consumed = match.end;
    facts.push(fact);
  }
  return false;
}

/** Finds and wraps every fact in the document, in document order. */
export function scanDocument(
  doc: Document,
  config: DetectorConfig,
  options: ScanOptions = {},
): ScanResult {
  const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;
  const compiled = compileDetectors(config);
  const facts: Fact[] = [];
  let truncated = false;
  const body: Element | null = doc.body;
  if (body !== null) {
    const lengths = new WeakMap<Element, number>();
    for (const node of collectTextNodes(doc, body, options.skipRootId)) {
      if (scanNode(doc, node, compiled.detectors, lengths, facts, maxFacts)) {
        truncated = true;
        break;
      }
    }
  }
  return compiled.error === undefined
    ? {facts, truncated}
    : {facts, truncated, error: compiled.error};
}

/** Removes every fact span and merges the text back together. */
export function unwrapFacts(doc: Document): void {
  const parents = new Set<Node>();
  for (const span of [...doc.querySelectorAll(`span.${FACT_CLASS}`)]) {
    const parent = span.parentNode;
    if (parent === null) {
      continue;
    }
    while (span.firstChild !== null) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parents.add(parent);
  }
  for (const parent of parents) {
    parent.normalize();
  }
}
