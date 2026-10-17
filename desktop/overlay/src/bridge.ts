/**
 * The JSON protocol between the overlay and the native app. See
 * `docs/DESKTOP_SPIDER.md`, section "Messages".
 */

import type {DetectorName} from './detectors';
import type {CrawlState} from './crawler';
import type {CategoryCounts, Fact} from './types';

export type OverlayMessage =
  | {readonly type: 'ready'; readonly url: string; readonly title: string}
  | {
      readonly type: 'scanned';
      readonly total: number;
      readonly truncated: boolean;
      readonly counts: CategoryCounts;
    }
  | {readonly type: 'visit'; readonly index: number; readonly total: number; readonly fact: Fact}
  | {readonly type: 'state'; readonly state: CrawlState}
  | {
      readonly type: 'facts';
      readonly url: string;
      readonly title: string;
      readonly facts: readonly Fact[];
    }
  | {readonly type: 'error'; readonly message: string};

export type Command =
  | {
      readonly cmd: 'configure';
      readonly detectors?: Partial<Record<DetectorName, boolean>>;
      readonly custom?: string;
      readonly paceMs?: number;
    }
  | {readonly cmd: 'run'}
  | {readonly cmd: 'pause'}
  | {readonly cmd: 'reset'}
  | {readonly cmd: 'setPace'; readonly paceMs: number}
  | {readonly cmd: 'goto'; readonly index: number}
  | {readonly cmd: 'export'};

interface MessageHandler {
  postMessage(message: unknown): void;
}

interface WebKitWindow {
  readonly webkit?: {
    readonly messageHandlers?: {
      readonly spider?: MessageHandler;
    };
  };
}

/** Sends a message to the app; logs it instead when running in a plain browser. */
export function postMessage(message: OverlayMessage): void {
  const handler = (globalThis as unknown as WebKitWindow).webkit?.messageHandlers?.spider;
  if (handler) {
    handler.postMessage(message);
  } else {
    console.debug('[spider]', message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parses a command from the app; returns null for anything malformed. */
export function parseCommand(json: string): Command | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw['cmd'] !== 'string') {
    return null;
  }
  switch (raw['cmd']) {
    case 'run':
    case 'pause':
    case 'reset':
    case 'export':
      return {cmd: raw['cmd']};
    case 'setPace':
      return typeof raw['paceMs'] === 'number' ? {cmd: 'setPace', paceMs: raw['paceMs']} : null;
    case 'goto':
      return typeof raw['index'] === 'number' ? {cmd: 'goto', index: raw['index']} : null;
    case 'configure': {
      const detectors = isRecord(raw['detectors'])
        ? (raw['detectors'] as Partial<Record<DetectorName, boolean>>)
        : undefined;
      return {
        cmd: 'configure',
        detectors,
        custom: typeof raw['custom'] === 'string' ? raw['custom'] : undefined,
        paceMs: typeof raw['paceMs'] === 'number' ? raw['paceMs'] : undefined,
      };
    }
    default:
      return null;
  }
}
