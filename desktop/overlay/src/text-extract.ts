/**
 * Runs the detectors over plain text (no DOM), so text captured outside a web
 * page gets the same facts the overlay finds. A line stands in for a paragraph
 * or table row.
 */

import {compileDetectors, findMatches, type DetectorConfig} from './detectors';
import {buildFact} from './fact';
import {clipContext} from './label';
import type {Fact} from './types';

const DEFAULT_MAX_FACTS = 400;

/** A line longer than this is not a sentence (same cap as the page scan). */
const MAX_LINE_CHARS = 2000;

export interface TextResult {
  readonly facts: Fact[];
  readonly truncated: boolean;
  readonly error?: string;
}

export function extractFromText(
  text: string,
  config: DetectorConfig,
  maxFacts: number = DEFAULT_MAX_FACTS,
): TextResult {
  const compiled = compileDetectors(config);
  const facts: Fact[] = [];
  let truncated = false;
  scan: for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length > MAX_LINE_CHARS) {
      continue;
    }
    for (const match of findMatches(line, compiled.detectors)) {
      if (facts.length >= maxFacts) {
        truncated = true;
        break scan;
      }
      const context = clipContext(line, match.start, match.end - match.start);
      facts.push(buildFact(facts.length, match, context));
    }
  }
  return compiled.error === undefined
    ? {facts, truncated}
    : {facts, truncated, error: compiled.error};
}
