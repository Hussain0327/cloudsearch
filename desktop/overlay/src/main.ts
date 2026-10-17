/**
 * Entry point. Installs `window.__spider` in the overlay's content world and
 * wires the scanner, the crawler, the spider sprite and the Found panel
 * together on whatever page this script was injected into.
 */

import {parseCommand, postMessage, type Command} from './bridge';
import {Crawler, DEFAULT_PACE_MS} from './crawler';
import {DEFAULT_CONFIG, type DetectorConfig} from './detectors';
import {FoundPanel} from './panel';
import {scanDocument, unwrapFacts} from './scan';
import {SpiderSprite, type Point} from './spider-sprite';
import {HIGHLIGHT_CSS, PALETTE} from './styles';
import {countByCategory, type Fact} from './types';

const ROOT_ID = 'cs-spider-root';
const STYLE_ID = 'cs-spider-style';

interface SpiderApi {
  command(json: string): void;
}

declare global {
  interface Window {
    __spider?: SpiderApi;
  }
}

class Overlay {
  private readonly doc: Document;
  private readonly root: HTMLDivElement;
  private readonly sprite: SpiderSprite;
  private readonly panel: FoundPanel;
  private readonly crawler: Crawler;
  private config: DetectorConfig = DEFAULT_CONFIG;
  private facts: Fact[] = [];
  private scanned = false;
  private currentEl: HTMLElement | null = null;

  constructor(doc: Document) {
    this.doc = doc;
    this.root = doc.createElement('div');
    this.root.id = ROOT_ID;
    this.sprite = new SpiderSprite(doc, {
      stroke: PALETTE.cyan,
      accent: PALETTE.accent,
      foot: '#e879a6',
      body: PALETTE.background,
    });
    this.panel = new FoundPanel(doc, {onSelect: (index) => this.crawler.goto(index)});
    this.root.append(this.sprite.svg, this.panel.host);
    this.crawler = new Crawler({
      onVisit: (index) => this.visit(index),
      onState: (state) => {
        this.sprite.setActive(state === 'running');
        postMessage({type: 'state', state});
      },
      paceMs: DEFAULT_PACE_MS,
    });
  }

  install(): void {
    const head = this.doc.head ?? this.doc.documentElement;
    if (!this.doc.getElementById(STYLE_ID)) {
      const style = this.doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = HIGHLIGHT_CSS;
      head.appendChild(style);
    }
    (this.doc.body ?? this.doc.documentElement).appendChild(this.root);
    this.updateIdle();
    this.sprite.rest();
    this.sprite.start();
    this.doc.defaultView?.addEventListener('resize', () => this.updateIdle());
    postMessage({type: 'ready', url: this.doc.location.href, title: this.doc.title});
  }

  command(json: string): void {
    const command = parseCommand(json);
    if (command === null) {
      postMessage({type: 'error', message: `Unrecognised command: ${json.slice(0, 120)}`});
      return;
    }
    try {
      this.apply(command);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      postMessage({type: 'error', message: reason});
    }
  }

  private apply(command: Command): void {
    switch (command.cmd) {
      case 'configure':
        this.configure(command);
        break;
      case 'run':
        this.ensureScanned();
        this.crawler.run();
        break;
      case 'pause':
        this.crawler.pause();
        break;
      case 'reset':
        this.reset();
        break;
      case 'setPace':
        this.crawler.setPace(command.paceMs);
        break;
      case 'goto':
        this.ensureScanned();
        this.crawler.goto(command.index);
        break;
      case 'export':
        postMessage({
          type: 'facts',
          url: this.doc.location.href,
          title: this.doc.title,
          facts: this.facts,
        });
        break;
    }
  }

  private configure(command: Extract<Command, {cmd: 'configure'}>): void {
    this.reset();
    this.config = {
      detectors: {...DEFAULT_CONFIG.detectors, ...(command.detectors ?? {})},
      custom: command.custom ?? '',
    };
    if (command.paceMs !== undefined) {
      this.crawler.setPace(command.paceMs);
    }
  }

  private ensureScanned(): void {
    if (this.scanned) {
      return;
    }
    unwrapFacts(this.doc);
    const result = scanDocument(this.doc, this.config, {skipRootId: ROOT_ID});
    this.facts = result.facts;
    this.scanned = true;
    this.crawler.load(this.facts.length);
    this.panel.setTotal(this.facts.length);
    if (result.error !== undefined) {
      postMessage({type: 'error', message: result.error});
    }
    postMessage({
      type: 'scanned',
      total: this.facts.length,
      truncated: result.truncated,
      counts: countByCategory(this.facts),
    });
  }

  private reset(): void {
    this.crawler.reset();
    this.currentEl?.classList.remove('cs-fact--current');
    this.currentEl = null;
    unwrapFacts(this.doc);
    this.facts = [];
    this.scanned = false;
    this.panel.reset();
    this.sprite.setTarget(null);
    this.sprite.clearTrail();
  }

  private visit(index: number): void {
    const fact = this.facts[index];
    if (!fact) {
      return;
    }
    const el = this.doc.querySelector<HTMLElement>(`[data-fact-id="${fact.id}"]`);
    if (!el) {
      return;
    }
    this.currentEl?.classList.remove('cs-fact--current');
    el.classList.add('cs-fact--hit', 'cs-fact--current', 'cs-fact--pulse');
    el.addEventListener('animationend', () => el.classList.remove('cs-fact--pulse'), {once: true});
    this.currentEl = el;

    const reduce = this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollIntoView({block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth'});

    this.sprite.setTarget(() => centreOf(el));
    const view = this.doc.defaultView;
    const centre = centreOf(el);
    this.sprite.pushTrail({x: centre.x + (view?.scrollX ?? 0), y: centre.y + (view?.scrollY ?? 0)});

    this.panel.addVisited(fact);
    this.panel.setActive(index);
    postMessage({type: 'visit', index, total: this.facts.length, fact});
  }

  private updateIdle(): void {
    const view = this.doc.defaultView;
    const width = view?.innerWidth ?? 800;
    const height = view?.innerHeight ?? 600;
    // Idle left of the panel so it never hides under it.
    this.sprite.setIdle({x: Math.max(80, (width - 340) / 2), y: Math.min(140, height / 3)});
  }
}

function centreOf(el: Element): Point {
  const rect = el.getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

function installOnce(): void {
  if (window.__spider) {
    return;
  }
  const overlay = new Overlay(document);
  window.__spider = {command: (json: string) => overlay.command(json)};
  if (document.body) {
    overlay.install();
  } else {
    document.addEventListener('DOMContentLoaded', () => overlay.install(), {once: true});
  }
}

installOnce();
