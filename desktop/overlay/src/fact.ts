/** Builds a `Fact` from a match. DOM-free, shared by the page scan and the text path. */

import {categoryFor, type Match} from './detectors';
import {labelForMatch} from './label';
import type {Fact} from './types';

export function factId(index: number): string {
  return `f-${String(index).padStart(5, '0')}`;
}

export function buildFact(index: number, match: Match, context: string): Fact {
  const text = match.text.replace(/\s+/g, ' ').trim();
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
