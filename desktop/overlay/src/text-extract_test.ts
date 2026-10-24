import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {test} from 'node:test';

import {DEFAULT_CONFIG} from './detectors';
import {extractFromText} from './text-extract';

const FIXTURES = new URL('../../fixtures/', import.meta.url);

test('numbers facts per line in order', () => {
  const result = extractFromText('Sales were $5 million.\nDebt of $2 billion due 2030.', DEFAULT_CONFIG);
  assert.deepEqual(result.facts.map((f) => f.id), ['f-00000', 'f-00001']);
  assert.equal(result.facts[0]?.text, '$5 million');
  assert.equal(result.facts[0]?.category, 'revenue');
  assert.equal(result.facts[1]?.category, 'debt');
});

test('stops at maxFacts and says so', () => {
  const result = extractFromText('$1 million\n$2 million\n$3 million', DEFAULT_CONFIG, 2);
  assert.equal(result.facts.length, 2);
  assert.equal(result.truncated, true);
});

test('skips lines longer than 2000 characters', () => {
  const result = extractFromText(`$1 million ${'x'.repeat(2000)}\n$2 million`, DEFAULT_CONFIG);
  assert.deepEqual(result.facts.map((f) => f.text), ['$2 million']);
});

test('reports a bad custom pattern without throwing', () => {
  const config = {...DEFAULT_CONFIG, detectors: {...DEFAULT_CONFIG.detectors, custom: true}, custom: '/(/'};
  const result = extractFromText('x', config);
  assert.equal(typeof result.error, 'string');
});

test('matches the golden file that the Swift self-test also checks', () => {
  const text = readFileSync(new URL('capture_sample.txt', FIXTURES), 'utf8');
  const golden = new URL('capture_sample.expected.json', FIXTURES);
  if (process.env['UPDATE_GOLDEN'] === '1') {
    const fresh = extractFromText(text, DEFAULT_CONFIG);
    writeFileSync(golden, `${JSON.stringify({config: DEFAULT_CONFIG, facts: fresh.facts}, null, 2)}\n`);
  }
  const expected = JSON.parse(readFileSync(golden, 'utf8')) as {config: typeof DEFAULT_CONFIG; facts: unknown};
  assert.deepEqual(extractFromText(text, expected.config).facts, expected.facts);
});
