import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

import {DEFAULT_CONFIG, type DetectorConfig} from './detectors';
import {scanDocument, unwrapFacts} from './scan';

function dom(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;
}

function spans(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('span.cs-fact')];
}

test('wraps matches in cs-fact spans in document order', () => {
  const doc = dom('<p>Sales were $5 million.</p><p>Debt of $2 billion due 2030.</p>');
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.facts.map((f) => f.id), ['f-00000', 'f-00001']);
  assert.deepEqual(result.facts.map((f) => f.index), [0, 1]);
  const found = spans(doc);
  assert.equal(found.length, 2);
  assert.equal(found[0]?.getAttribute('data-fact-id'), 'f-00000');
  assert.equal(found[0]?.textContent, '$5 million');
  assert.equal(found[0]?.getAttribute('data-kind'), 'money');
  assert.equal(found[0]?.getAttribute('data-category'), 'revenue');
  assert.equal(found[1]?.getAttribute('data-category'), 'debt');
});

test('skips script, style and the overlay root', () => {
  const doc = dom(
    '<script>var x = "$9 million";</script><style>.a{}</style>' +
      '<div id="cs-spider-root">$8 million</div><p>$7 million</p>',
  );
  const result = scanDocument(doc, DEFAULT_CONFIG, {skipRootId: 'cs-spider-root'});
  assert.deepEqual(result.facts.map((f) => f.text), ['$7 million']);
});

test('never crosses an element boundary', () => {
  const doc = dom('<p><b>$24.6</b> billion</p>');
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.deepEqual(result.facts.map((f) => f.text), ['$24.6']);
  const inner = doc.querySelector('b > span.cs-fact');
  assert.ok(inner, 'span stays inside the <b>');
  assert.equal(inner.children.length, 0);
  assert.equal(doc.body.textContent, '$24.6 billion');
});

test('stops at maxFacts and reports truncated', () => {
  const doc = dom('<p>$1</p>'.repeat(500));
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.equal(result.facts.length, 400);
  assert.equal(result.truncated, true);
  assert.equal(spans(doc).length, 400);
  const small = scanDocument(dom('<p>$1</p>'.repeat(5)), DEFAULT_CONFIG, {maxFacts: 3});
  assert.equal(small.facts.length, 3);
  assert.equal(small.truncated, true);
});

test('unwrap restores the text and a rescan yields identical ids', () => {
  const html = '<p>Sales were $5 million.</p><p>Debt of $2 billion.</p>';
  const doc = dom(html);
  const first = scanDocument(doc, DEFAULT_CONFIG);
  unwrapFacts(doc);
  assert.equal(spans(doc).length, 0);
  assert.equal(doc.body.textContent, 'Sales were $5 million.Debt of $2 billion.');
  const second = scanDocument(doc, DEFAULT_CONFIG);
  assert.deepEqual(
    second.facts.map((f) => [f.id, f.text]),
    first.facts.map((f) => [f.id, f.text]),
  );
  assert.equal(spans(doc).length, 2);
});

test('a fact carries category, label, value and a clipped context', () => {
  const doc = dom(
    '<p>In 2025, the aggregate market value of the voting stock was approximately $3.2 trillion.</p>',
  );
  const result = scanDocument(doc, DEFAULT_CONFIG);
  const fact = result.facts[0];
  assert.ok(fact);
  assert.equal(fact.category, 'other');
  assert.equal(fact.kind, 'money');
  assert.equal(fact.label, 'market value of the voting stock');
  assert.equal(fact.value, 3_200_000_000_000);
  assert.equal(fact.unit, 'USD');
  assert.ok(fact.context.includes('aggregate market value'));
  assert.ok(fact.context.length <= 240);
});

test('context classification uses the surrounding block', () => {
  const doc = dom('<p>Total net sales increased 2% to $391.0 billion.</p>');
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.deepEqual(
    result.facts.map((f) => [f.text, f.category]),
    [['2%', 'revenue'], ['$391.0 billion', 'revenue']],
  );
});

test('fact text collapses whitespace inside the match', () => {
  const doc = dom('<p>$24.6\n   billion</p>');
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.deepEqual(result.facts.map((f) => f.text), ['$24.6 billion']);
});

test('an invalid custom pattern is reported but other facts are still found', () => {
  const config: DetectorConfig = {...DEFAULT_CONFIG, custom: '/(/'};
  const result = scanDocument(dom('<p>$7 million</p>'), config);
  assert.match(result.error ?? '', /custom/i);
  assert.equal(result.facts.length, 1);
});

test('hidden content is skipped when the browser can tell', () => {
  const doc = dom('<p hidden>$1 million</p><p>$2 million</p>');
  // jsdom has no layout; emulate checkVisibility on the hidden paragraph.
  const hiddenParagraph = doc.querySelector('p[hidden]');
  assert.ok(hiddenParagraph);
  Object.defineProperty(hiddenParagraph, 'checkVisibility', {value: () => false});
  const result = scanDocument(doc, DEFAULT_CONFIG);
  assert.deepEqual(result.facts.map((f) => f.text), ['$2 million']);
});
