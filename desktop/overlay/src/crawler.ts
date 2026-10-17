/**
 * The crawl state machine: which fact the spider stands on, and when it moves
 * to the next one. Timing goes through a `Scheduler` so tests can drive it by
 * hand.
 */

export type CrawlState = 'idle' | 'running' | 'paused' | 'done';

export interface Scheduler {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export const MIN_PACE_MS = 60;
export const MAX_PACE_MS = 1500;
export const DEFAULT_PACE_MS = 350;

export function clampPace(ms: number): number {
  if (!Number.isFinite(ms)) {
    return DEFAULT_PACE_MS;
  }
  return Math.min(MAX_PACE_MS, Math.max(MIN_PACE_MS, Math.round(ms)));
}

const TIMER_SCHEDULER: Scheduler = {
  // In the page this is a number; the cast covers the Node typings used by tests.
  set: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clear: (id) => globalThis.clearTimeout(id),
};

export interface CrawlerOptions {
  readonly onVisit: (index: number) => void;
  readonly onState: (state: CrawlState) => void;
  readonly scheduler?: Scheduler;
  readonly paceMs?: number;
}

export class Crawler {
  private readonly onVisit: (index: number) => void;
  private readonly onState: (state: CrawlState) => void;
  private readonly scheduler: Scheduler;
  private pace: number;
  private total = 0;
  private index = -1;
  private current: CrawlState = 'idle';
  private timer: number | null = null;

  constructor(options: CrawlerOptions) {
    this.onVisit = options.onVisit;
    this.onState = options.onState;
    this.scheduler = options.scheduler ?? TIMER_SCHEDULER;
    this.pace = clampPace(options.paceMs ?? DEFAULT_PACE_MS);
  }

  get state(): CrawlState {
    return this.current;
  }

  /** Index of the fact the spider stands on; -1 before the first hop. */
  get position(): number {
    return this.index;
  }

  get paceMs(): number {
    return this.pace;
  }

  /** Sets the number of facts on the page and goes back to idle. */
  load(total: number): void {
    this.clearTimer();
    this.total = Math.max(0, Math.floor(total));
    this.index = -1;
    this.setState('idle');
  }

  /** Starts from the first fact, resumes a pause, or restarts after done. */
  run(): void {
    if (this.current === 'running') {
      return;
    }
    if (this.current === 'done') {
      this.index = -1;
    }
    if (this.total === 0) {
      this.setState('done');
      return;
    }
    if (this.index >= this.total - 1) {
      this.setState('done');
      return;
    }
    this.setState('running');
    if (this.index < 0) {
      this.visit(0);
    } else {
      this.scheduleNext();
    }
  }

  pause(): void {
    if (this.current !== 'running') {
      return;
    }
    this.clearTimer();
    this.setState('paused');
  }

  reset(): void {
    this.clearTimer();
    this.index = -1;
    this.setState('idle');
  }

  /** Applies from the next hop; the hop in flight keeps its timing. */
  setPace(ms: number): void {
    this.pace = clampPace(ms);
  }

  /** Jumps to a fact. Keeps walking if running, otherwise stays there paused. */
  goto(index: number): void {
    if (this.total === 0) {
      return;
    }
    this.clearTimer();
    const target = Math.min(this.total - 1, Math.max(0, Math.floor(index)));
    if (this.current !== 'running') {
      this.setState('paused');
    }
    this.visit(target);
  }

  private visit(index: number): void {
    this.index = index;
    this.onVisit(index);
    if (this.current !== 'running') {
      return;
    }
    if (index >= this.total - 1) {
      this.setState('done');
    } else {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      this.visit(this.index + 1);
    }, this.pace);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
  }

  private setState(next: CrawlState): void {
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.onState(next);
  }
}
