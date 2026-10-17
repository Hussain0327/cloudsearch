import assert from 'node:assert/strict';
import {test} from 'node:test';

import {clipContext, labelForMatch} from './label';

test('label prefers the clause before the figure and drops weak tail words', () => {
  assert.equal(
    labelForMatch('Total net sales increased 2% to $391.0 billion in 2025.', '$391.0 billion'),
    'Total net sales increased',
  );
});

test('label drops leading year filler and keeps the last six words', () => {
  assert.equal(
    labelForMatch(
      'In 2025, the aggregate market value of the voting stock was approximately $3.2 trillion.',
      '$3.2 trillion',
    ),
    'market value of the voting stock',
  );
});

test('label falls back to the sentence start when fewer than two words remain', () => {
  assert.equal(
    labelForMatch('Cash was $5 million at year end.', '$5 million'),
    'Cash was million at year end',
  );
});

test('label falls back to the sentence start when the match is absent', () => {
  assert.equal(labelForMatch('The quick brown fox jumps over.', '$1'), 'quick brown fox jumps over');
});

test('clipContext centres on the match, collapses whitespace and respects the limit', () => {
  const block = `${'A'.repeat(300)}\n\n   $5   million ${'B'.repeat(300)}`;
  const start = block.indexOf('$5');
  const clipped = clipContext(block, start, '$5   million'.length);
  assert.ok(clipped.length <= 240, `length ${clipped.length}`);
  assert.ok(clipped.includes('$5 million'));
  assert.ok(!/\s{2}/.test(clipped));
});

test('clipContext returns short blocks whole', () => {
  assert.equal(clipContext('  Debt of $2 billion.  ', 8, 10), 'Debt of $2 billion.');
});
