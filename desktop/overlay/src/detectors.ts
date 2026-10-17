/**
 * Regex detectors for the figures the spider collects. The built-in patterns
 * are ports of the untagged-text pass in `src/ingestion/edgar/extract.py`;
 * the context classifier is a port of `classify_context` in `classify.py`.
 */

import type {Category, Kind, Unit} from './types';

export type DetectorName =
  | 'notes'
  | 'money'
  | 'shares'
  | 'percent'
  | 'date'
  | 'number'
  | 'email'
  | 'custom';

/** Priority order: when two candidates start at the same offset, the earlier one wins. */
export const DETECTOR_NAMES: readonly DetectorName[] = [
  'notes',
  'money',
  'shares',
  'percent',
  'date',
  'number',
  'email',
  'custom',
];

export interface DetectorConfig {
  readonly detectors: Readonly<Record<DetectorName, boolean>>;
  /** Comma-separated words, or a single `/regex/`. Empty disables `custom`. */
  readonly custom: string;
}

export const DEFAULT_CONFIG: DetectorConfig = {
  detectors: {
    notes: true,
    money: true,
    shares: true,
    percent: true,
    date: true,
    number: false,
    email: false,
    custom: true,
  },
  custom: '',
};

/** What a detector found in one string, before it is wrapped in the page. */
export interface Match {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly detector: DetectorName;
  readonly kind: Kind;
  readonly value: number | null;
  readonly unit: Unit;
  /** Set when the detector fixes the category; otherwise the context decides. */
  readonly category?: Category;
  /** Set when the detector knows a better label than the surrounding words. */
  readonly label?: string;
}

type Interpretation = Pick<Match, 'kind' | 'value' | 'unit' | 'category' | 'label'>;

export interface CompiledDetector {
  readonly name: DetectorName;
  /** Must carry the `g` flag; `findMatches` resets `lastIndex`. */
  readonly regex: RegExp;
  readonly interpret: (match: RegExpExecArray) => Interpretation;
}

export interface CompileResult {
  readonly detectors: readonly CompiledDetector[];
  /** Set when the custom pattern did not compile; the other detectors still work. */
  readonly error?: string;
}

const MULTIPLIERS: Readonly<Record<string, number>> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

const MONTH =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December' +
  '|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';

const PATTERNS: Readonly<Record<Exclude<DetectorName, 'custom'>, string>> = {
  notes: String.raw`(\d+(?:\.\d+)?)%\s+(?:Senior\s+|Fixed[- ]Rate\s+|Floating[- ]Rate\s+)?Notes?\s+due\s+(\d{4})`,
  money: String.raw`([$€£¥])\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(trillion|billion|million|thousand))?\b`,
  shares: String.raw`(\d{1,3}(?:,\d{3})+)\s+shares\b`,
  percent: String.raw`(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%`,
  date:
    String.raw`\b${MONTH}\.?\s+\d{1,2},?\s+\d{4}\b` +
    String.raw`|\b\d{1,2}\s+${MONTH}\.?\s+\d{4}\b` +
    String.raw`|\b\d{4}-\d{2}-\d{2}\b` +
    String.raw`|\b\d{1,2}/\d{1,2}/\d{4}\b`,
  number: String.raw`\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b`,
  email: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
};

function parseGrouped(digits: string): number {
  return Number(digits.replace(/,/g, ''));
}

/** Rounds away the float noise of `24.6 * 1e9`. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

const INTERPRETERS: Readonly<
  Record<Exclude<DetectorName, 'custom'>, (match: RegExpExecArray) => Interpretation>
> = {
  notes: (m) => ({
    kind: 'percent',
    value: Number(m[1] ?? ''),
    unit: 'percent',
    category: 'debt',
    label: `Notes due ${m[2] ?? ''}`,
  }),
  money: (m) => {
    const multiplier = MULTIPLIERS[(m[3] ?? '').toLowerCase()] ?? 1;
    return {
      kind: 'money',
      value: roundCents(parseGrouped(m[2] ?? '') * multiplier),
      unit: m[1] === '$' ? 'USD' : null,
    };
  },
  shares: (m) => ({
    kind: 'shares',
    value: parseGrouped(m[1] ?? ''),
    unit: 'shares',
    category: 'shares',
  }),
  percent: (m) => ({kind: 'percent', value: Number(m[1] ?? ''), unit: 'percent'}),
  date: () => ({kind: 'date', value: null, unit: null, category: 'other'}),
  number: (m) => ({kind: 'text', value: parseGrouped(m[0]), unit: null}),
  email: () => ({kind: 'entity', value: null, unit: null, category: 'other'}),
};

const REGEX_FORM = /^\/(.+)\/([a-z]*)$/s;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileCustom(pattern: string): {detector?: CompiledDetector; error?: string} {
  const trimmed = pattern.trim();
  if (trimmed === '') {
    return {};
  }
  const interpret = (): Interpretation => ({
    kind: 'text',
    value: null,
    unit: null,
    category: 'custom',
  });
  const form = REGEX_FORM.exec(trimmed);
  if (form) {
    const flags = [...new Set(['g', 'i', ...(form[2] ?? '')])].join('');
    try {
      return {detector: {name: 'custom', regex: new RegExp(form[1] ?? '', flags), interpret}};
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      return {error: `Custom pattern is not a valid regex: ${reason}`};
    }
  }
  const words = trimmed
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
  if (words.length === 0) {
    return {};
  }
  const source = String.raw`\b(?:${words.map(escapeRegExp).join('|')})\b`;
  return {detector: {name: 'custom', regex: new RegExp(source, 'gi'), interpret}};
}

export function compileDetectors(config: DetectorConfig): CompileResult {
  const detectors: CompiledDetector[] = [];
  let error: string | undefined;
  for (const name of DETECTOR_NAMES) {
    if (!config.detectors[name]) {
      continue;
    }
    if (name === 'custom') {
      const custom = compileCustom(config.custom);
      if (custom.error !== undefined) {
        error = custom.error;
      }
      if (custom.detector) {
        detectors.push(custom.detector);
      }
      continue;
    }
    detectors.push({name, regex: new RegExp(PATTERNS[name], 'gi'), interpret: INTERPRETERS[name]});
  }
  return error === undefined ? {detectors} : {detectors, error};
}

interface Candidate {
  readonly match: Match;
  readonly priority: number;
}

/**
 * Runs every detector over `text` and returns the non-overlapping matches in
 * text order. Overlaps resolve to the earliest start, then detector priority.
 */
export function findMatches(text: string, detectors: readonly CompiledDetector[]): Match[] {
  const candidates: Candidate[] = [];
  detectors.forEach((detector, priority) => {
    detector.regex.lastIndex = 0;
    for (let m = detector.regex.exec(text); m !== null; m = detector.regex.exec(text)) {
      if (m[0] === '') {
        // A custom regex may match the empty string; step past it.
        detector.regex.lastIndex += 1;
        continue;
      }
      candidates.push({
        priority,
        match: {
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          detector: detector.name,
          ...detector.interpret(m),
        },
      });
    }
  });
  candidates.sort((a, b) => a.match.start - b.match.start || a.priority - b.priority);
  const matches: Match[] = [];
  let lastEnd = -1;
  for (const candidate of candidates) {
    if (candidate.match.start < lastEnd) {
      continue;
    }
    matches.push(candidate.match);
    lastEnd = candidate.match.end;
  }
  return matches;
}

const DEBT_WORDS =
  /\b(notes?|debt|borrow\w*|interest|coupon|commercial paper|credit (?:facility|agreement)|indenture|principal|matur\w*|repay\w*|financing|term loan|lease liabilit\w*)\b/i;
const REVENUE_WORDS = /\b(net sales|revenues?|sales)\b/i;
const SHARES_WORDS = /\b(shares?|repurchas\w*|dividends?|outstanding)\b/i;

/** Picks a category for a figure from the words around it. */
export function classifyContext(context: string, kind: Kind): Category {
  if (kind === 'shares') {
    return 'shares';
  }
  if (DEBT_WORDS.test(context)) {
    return 'debt';
  }
  if (REVENUE_WORDS.test(context)) {
    return 'revenue';
  }
  if (SHARES_WORDS.test(context)) {
    return 'shares';
  }
  return 'other';
}

export function categoryFor(match: Match, context: string): Category {
  return match.category ?? classifyContext(context, match.kind);
}
