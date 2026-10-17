/**
 * Short labels and context snippets for a found figure. Ports of
 * `label_for_match`, `label_from_sentence` and the context clipping in
 * `src/ingestion/edgar/classify.py` and `extract.py`.
 */

const STOP_PREFIX =
  /^(?:(?:in|during|for|as of|at)\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:(?:the|a|an|our|its|approximately)\b)?\s*/i;
const WORD = /[A-Za-z][A-Za-z'’\-]*/g;

/** Words that carry no meaning at the end of a label ("... was approximately"). */
const WEAK_TAIL = new Set([
  'was', 'were', 'is', 'are', 'of', 'to', 'by', 'or', 'and', 'at', 'approximately',
  'totaled', 'totaling', 'the', 'a', 'an', 'for', 'from', 'in', 'with', 'had', 'has',
  'have', 'be', 'about', 'up', 'than', 'on', 'as', 'its', 'our',
]);

function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** The first few meaningful words of a sentence. */
export function labelFromSentence(sentence: string, maxWords = 6): string {
  const found = words(sentence.trim().replace(STOP_PREFIX, ''));
  return found.length > 0 ? found.slice(0, maxWords).join(' ') : 'Figure';
}

/**
 * Labels a figure from the words around it: prefers the clause leading up to
 * the figure, drops trailing filler, and falls back to the start of the
 * sentence when too little is left.
 */
export function labelForMatch(context: string, matchText: string, maxWords = 6): string {
  const position = context.indexOf(matchText);
  if (position < 0) {
    return labelFromSentence(context, maxWords);
  }
  const before = words(context.slice(0, position).trim().replace(STOP_PREFIX, ''));
  while (before.length > 0 && WEAK_TAIL.has((before[before.length - 1] ?? '').toLowerCase())) {
    before.pop();
  }
  const tail = before.slice(-maxWords);
  if (tail.length >= 2) {
    return tail.join(' ');
  }
  return labelFromSentence(context, maxWords);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A window of at most `max` characters of `blockText` centred on the match,
 * with whitespace collapsed.
 */
export function clipContext(
  blockText: string,
  matchStart: number,
  matchLength: number,
  max = 240,
): string {
  if (blockText.length <= max) {
    return collapseWhitespace(blockText);
  }
  const spare = Math.max(0, max - matchLength);
  const end = Math.min(blockText.length, Math.max(0, matchStart - Math.floor(spare / 2)) + max);
  const start = Math.max(0, end - max);
  return collapseWhitespace(blockText.slice(start, end));
}
