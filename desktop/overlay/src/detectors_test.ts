import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  DEFAULT_CONFIG,
  classifyContext,
  compileDetectors,
  findMatches,
  type DetectorConfig,
  type DetectorName,
  type Match,
} from './detectors';

function matches(text: string, config: DetectorConfig = DEFAULT_CONFIG): Match[] {
  return findMatches(text, compileDetectors(config).detectors);
}

function withConfig(
  overrides: Partial<Record<DetectorName, boolean>>,
  custom = '',
): DetectorConfig {
  return {detectors: {...DEFAULT_CONFIG.detectors, ...overrides}, custom};
}

function only(found: Match[]): Match {
  assert.equal(found.length, 1, `expected one match, got ${JSON.stringify(found)}`);
  const m = found[0];
  assert.ok(m);
  return m;
}

test('money parses a dollar amount with a billion multiplier', () => {
  const m = only(matches('Net sales were $24.6 billion in 2025.'));
  assert.equal(m.detector, 'money');
  assert.equal(m.text, '$24.6 billion');
  assert.equal(m.kind, 'money');
  assert.equal(m.value, 24_600_000_000);
  assert.equal(m.unit, 'USD');
});

test('money with a euro sign keeps the grouped value and has no unit', () => {
  const m = only(matches('€1,234.50 paid'));
  assert.equal(m.text, '€1,234.50');
  assert.equal(m.value, 1234.5);
  assert.equal(m.unit, null);
});

test('notes beats percent on 3.600% Notes due 2042', () => {
  const m = only(matches('our 3.600% Notes due 2042 and'));
  assert.equal(m.detector, 'notes');
  assert.equal(m.text, '3.600% Notes due 2042');
  assert.equal(m.kind, 'percent');
  assert.equal(m.value, 3.6);
  assert.equal(m.unit, 'percent');
  assert.equal(m.category, 'debt');
  assert.equal(m.label, 'Notes due 2042');
});

test('shares parses a grouped share count', () => {
  const m = only(matches('14,776,353,000 shares of common stock'));
  assert.equal(m.detector, 'shares');
  assert.equal(m.kind, 'shares');
  assert.equal(m.value, 14_776_353_000);
  assert.equal(m.unit, 'shares');
  assert.equal(m.category, 'shares');
});

test('percent allows a space before the sign and leaves category to context', () => {
  const m = only(matches('an interest rate of 4.25 % per year'));
  assert.equal(m.detector, 'percent');
  assert.equal(m.text, '4.25 %');
  assert.equal(m.value, 4.25);
  assert.equal(m.unit, 'percent');
  assert.equal(m.category, undefined);
});

test('classifyContext follows debt, then revenue, then shares words', () => {
  assert.equal(classifyContext('an interest rate of 4.25% per year', 'percent'), 'debt');
  assert.equal(classifyContext('Net sales grew 2% in the quarter', 'percent'), 'revenue');
  assert.equal(classifyContext('dividends of $0.25 per share', 'money'), 'shares');
  assert.equal(classifyContext('about 40% of employees', 'percent'), 'other');
  assert.equal(classifyContext('whatever the words are', 'shares'), 'shares');
});

test('date matches long, iso, slash and day-first forms', () => {
  const found = matches(
    'ended September 27, 2025 (2025-09-27), filed 10/31/2025, due 27 September 2025 or Sep 1, 2026',
  );
  assert.deepEqual(
    found.map((m) => m.text),
    ['September 27, 2025', '2025-09-27', '10/31/2025', '27 September 2025', 'Sep 1, 2026'],
  );
  for (const m of found) {
    assert.equal(m.detector, 'date');
    assert.equal(m.kind, 'date');
    assert.equal(m.value, null);
    assert.equal(m.category, 'other');
  }
});

test('custom words match whole words case-insensitively', () => {
  const found = matches(
    'The iPhone and the mac mini, not the Macintosh',
    withConfig({}, 'iPhone, Mac'),
  );
  assert.deepEqual(found.map((m) => m.text), ['iPhone', 'mac']);
  for (const m of found) {
    assert.equal(m.detector, 'custom');
    assert.equal(m.category, 'custom');
    assert.equal(m.kind, 'text');
  }
});

test('custom accepts a /regex/ form', () => {
  const m = only(matches('In Q4 2025 we', withConfig({}, '/Q[1-4] 20\\d\\d/')));
  assert.equal(m.detector, 'custom');
  assert.equal(m.text, 'Q4 2025');
});

test('an invalid custom regex reports an error and keeps the other detectors', () => {
  const result = compileDetectors(withConfig({}, '/(/'));
  assert.match(result.error ?? '', /custom/i);
  const m = only(findMatches('$5 billion', result.detectors));
  assert.equal(m.detector, 'money');
});

test('a disabled detector yields nothing', () => {
  assert.deepEqual(matches('$5 billion', withConfig({money: false})), []);
});

test('overlapping candidates resolve to the earliest start', () => {
  const m = only(matches('$1,234,567 total', withConfig({number: true})));
  assert.equal(m.detector, 'money');
  assert.equal(m.text, '$1,234,567');
});

test('number detector parses grouped plain numbers when enabled', () => {
  const m = only(matches('about 1,234,567 units', withConfig({number: true})));
  assert.equal(m.detector, 'number');
  assert.equal(m.kind, 'text');
  assert.equal(m.value, 1_234_567);
  assert.equal(m.unit, null);
});

test('email detector is off by default and finds addresses when on', () => {
  assert.deepEqual(matches('write to ir@example.com today'), []);
  const m = only(matches('write to ir@example.com today', withConfig({email: true})));
  assert.equal(m.detector, 'email');
  assert.equal(m.kind, 'entity');
  assert.equal(m.category, 'other');
});

test('matches come back in text order', () => {
  const found = matches('$5 million then 10% then $2');
  assert.deepEqual(found.map((m) => m.detector), ['money', 'percent', 'money']);
});
