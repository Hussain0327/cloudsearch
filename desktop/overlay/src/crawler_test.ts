import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  Crawler,
  DEFAULT_PACE_MS,
  MAX_PACE_MS,
  MIN_PACE_MS,
  clampPace,
  type CrawlState,
  type Scheduler,
} from './crawler';

/** A scheduler the test fires by hand. */
class ManualScheduler implements Scheduler {
  private nextId = 1;
  readonly pending = new Map<number, {fn: () => void; ms: number}>();

  set(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, {fn, ms});
    return id;
  }

  clear(id: number): void {
    this.pending.delete(id);
  }

  /** Fires the single pending timer. */
  fire(): void {
    const entries = [...this.pending.entries()];
    assert.equal(entries.length, 1, 'expected exactly one pending timer');
    const entry = entries[0];
    assert.ok(entry);
    this.pending.delete(entry[0]);
    entry[1].fn();
  }

  get delays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }
}

function setup(total: number, paceMs?: number) {
  const scheduler = new ManualScheduler();
  const visited: number[] = [];
  const states: CrawlState[] = [];
  const crawler = new Crawler({
    onVisit: (i) => visited.push(i),
    onState: (s) => states.push(s),
    scheduler,
    paceMs,
  });
  crawler.load(total);
  return {crawler, scheduler, visited, states};
}

test('run visits index 0 immediately and schedules the next hop at the pace', () => {
  const {crawler, scheduler, visited} = setup(5);
  crawler.run();
  assert.deepEqual(visited, [0]);
  assert.deepEqual(scheduler.delays, [DEFAULT_PACE_MS]);
  scheduler.fire();
  assert.deepEqual(visited, [0, 1]);
  assert.equal(crawler.state, 'running');
});

test('pause stops scheduling and run resumes with the next index', () => {
  const {crawler, scheduler, visited} = setup(5);
  crawler.run();
  crawler.pause();
  assert.equal(crawler.state, 'paused');
  assert.deepEqual(scheduler.delays, []);
  crawler.run();
  assert.deepEqual(visited, [0], 'resume does not revisit');
  scheduler.fire();
  assert.deepEqual(visited, [0, 1]);
});

test('setPace applies to the next hop without cutting the current one short', () => {
  const {crawler, scheduler} = setup(5);
  crawler.run();
  crawler.setPace(100);
  assert.deepEqual(scheduler.delays, [DEFAULT_PACE_MS]);
  scheduler.fire();
  assert.deepEqual(scheduler.delays, [100]);
  assert.equal(crawler.paceMs, 100);
});

test('goto jumps to the index and continues from there while running', () => {
  const {crawler, scheduler, visited} = setup(10);
  crawler.run();
  crawler.goto(5);
  assert.deepEqual(visited, [0, 5]);
  scheduler.fire();
  assert.deepEqual(visited, [0, 5, 6]);
});

test('goto while idle visits the index and leaves the crawl paused', () => {
  const {crawler, scheduler, visited} = setup(10);
  crawler.goto(3);
  assert.deepEqual(visited, [3]);
  assert.equal(crawler.state, 'paused');
  assert.deepEqual(scheduler.delays, []);
});

test('reaching the last fact emits done and leaves nothing pending', () => {
  const {crawler, scheduler, visited, states} = setup(2);
  crawler.run();
  scheduler.fire();
  assert.deepEqual(visited, [0, 1]);
  assert.deepEqual(states, ['running', 'done']);
  assert.deepEqual(scheduler.delays, []);
});

test('run on an empty page goes straight to done', () => {
  const {crawler, states, visited} = setup(0);
  crawler.run();
  assert.deepEqual(visited, []);
  assert.deepEqual(states, ['done']);
});

test('reset clears the timer and position so run starts over', () => {
  const {crawler, scheduler, visited} = setup(5);
  crawler.run();
  scheduler.fire();
  crawler.reset();
  assert.equal(crawler.state, 'idle');
  assert.equal(crawler.position, -1);
  assert.deepEqual(scheduler.delays, []);
  crawler.run();
  assert.deepEqual(visited, [0, 1, 0]);
});

test('pace is clamped to the allowed range', () => {
  assert.equal(clampPace(10), MIN_PACE_MS);
  assert.equal(clampPace(9999), MAX_PACE_MS);
  assert.equal(clampPace(350), 350);
  assert.equal(new Crawler({onVisit: () => {}, onState: () => {}}).paceMs, DEFAULT_PACE_MS);
});
