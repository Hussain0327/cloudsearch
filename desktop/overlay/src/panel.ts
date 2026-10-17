/**
 * The Found panel: header, category chips with live counts, and one row per
 * visited fact, newest at the bottom. Rendered in a shadow root so the page's
 * CSS cannot restyle it.
 */

import {CATEGORY_COLOR, PANEL_CSS} from './styles';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  countByCategory,
  type Category,
  type Fact,
} from './types';

export interface PanelCallbacks {
  readonly onSelect: (index: number) => void;
}

/** $3.25T / $391.0B / $12.4M / $950K / $42 */
export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units: Array<[number, string]> = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const scaled = abs / div;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}$${scaled.toFixed(digits)}${suffix}`;
    }
  }
  return `${sign}$${abs.toLocaleString('en-US', {maximumFractionDigits: 2})}`;
}

/** The mono "value" cell for a row. */
export function formatFactValue(fact: Fact): string {
  if (fact.value === null || Number.isNaN(fact.value)) {
    return fact.text;
  }
  if (fact.kind === 'money' && fact.unit === 'USD') {
    return formatMoney(fact.value);
  }
  if (fact.kind === 'shares') {
    return fact.value.toLocaleString('en-US', {maximumFractionDigits: 0});
  }
  return fact.text;
}

export class FoundPanel {
  readonly host: HTMLElement;
  private readonly doc: Document;
  private readonly callbacks: PanelCallbacks;
  private readonly panel: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly rowsEl: HTMLOListElement;
  private readonly emptyEl: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly rowByIndex = new Map<number, HTMLButtonElement>();
  private visited: Fact[] = [];
  private total = 0;
  private filter: Category | null = null;
  private activeIndex: number | null = null;
  private collapsed = false;

  constructor(doc: Document, callbacks: PanelCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    this.host = doc.createElement('div');
    this.host.id = 'cs-spider-panel';
    const shadow = this.host.attachShadow({mode: 'open'});
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    this.panel = doc.createElement('section');
    this.panel.className = 'panel';
    shadow.appendChild(this.panel);

    const header = doc.createElement('div');
    header.className = 'header';
    const title = doc.createElement('span');
    title.className = 'title';
    title.textContent = 'Found';
    this.countEl = doc.createElement('span');
    this.countEl.className = 'count';
    this.toggleEl = doc.createElement('button');
    this.toggleEl.className = 'toggle';
    this.toggleEl.type = 'button';
    this.toggleEl.title = 'Collapse';
    this.toggleEl.textContent = '▾';
    this.toggleEl.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    header.append(title, this.countEl, this.toggleEl);
    this.panel.appendChild(header);

    this.chipsEl = doc.createElement('div');
    this.chipsEl.className = 'chips';
    this.panel.appendChild(this.chipsEl);

    this.rowsEl = doc.createElement('ol');
    this.rowsEl.className = 'rows';
    this.emptyEl = doc.createElement('li');
    this.emptyEl.className = 'empty';
    this.emptyEl.textContent = 'Nothing found yet. Press Run and the spider starts walking the page.';
    this.rowsEl.appendChild(this.emptyEl);
    this.panel.appendChild(this.rowsEl);

    this.renderChips();
    this.renderCount();
  }

  setTotal(total: number): void {
    this.total = total;
    this.renderCount();
  }

  reset(): void {
    this.visited = [];
    this.total = 0;
    this.activeIndex = null;
    this.rowByIndex.clear();
    this.rowsEl.replaceChildren(this.emptyEl);
    this.renderChips();
    this.renderCount();
  }

  /** Adds a row for a fact the spider has reached (once). */
  addVisited(fact: Fact): void {
    if (this.rowByIndex.has(fact.index)) {
      return;
    }
    this.visited.push(fact);
    this.emptyEl.remove();
    const row = this.buildRow(fact);
    this.rowByIndex.set(fact.index, row);
    const li = this.doc.createElement('li');
    li.appendChild(row);
    this.rowsEl.appendChild(li);
    this.applyFilter();
    this.renderChips();
    this.renderCount();
    this.rowsEl.scrollTop = this.rowsEl.scrollHeight;
  }

  setActive(index: number | null): void {
    if (this.activeIndex !== null) {
      this.rowByIndex.get(this.activeIndex)?.removeAttribute('aria-current');
    }
    this.activeIndex = index;
    if (index !== null) {
      this.rowByIndex.get(index)?.setAttribute('aria-current', 'true');
    }
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.panel.classList.toggle('collapsed', collapsed);
    this.toggleEl.textContent = collapsed ? '▸' : '▾';
    this.toggleEl.title = collapsed ? 'Expand' : 'Collapse';
  }

  private buildRow(fact: Fact): HTMLButtonElement {
    const row = this.doc.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.style.setProperty('--c', CATEGORY_COLOR[fact.category]);
    row.dataset['category'] = fact.category;
    row.title = fact.context;
    row.addEventListener('click', () => this.callbacks.onSelect(fact.index));

    const bar = this.doc.createElement('span');
    bar.className = 'bar';
    const main = this.doc.createElement('span');
    main.className = 'main';
    const value = this.doc.createElement('span');
    value.className = 'value';
    value.textContent = formatFactValue(fact);
    const label = this.doc.createElement('span');
    label.className = 'label';
    label.textContent = fact.label;
    main.append(value, label);
    const cat = this.doc.createElement('span');
    cat.className = 'cat';
    cat.textContent = CATEGORY_LABELS[fact.category];
    row.append(bar, main, cat);
    return row;
  }

  private renderCount(): void {
    this.countEl.textContent = `${this.visited.length} of ${this.total} found`;
  }

  private renderChips(): void {
    const counts = countByCategory(this.visited);
    const chips: HTMLButtonElement[] = [];
    chips.push(this.buildChip('All', this.visited.length, null));
    for (const category of CATEGORIES) {
      if (counts[category] === 0 && this.filter !== category) {
        continue;
      }
      chips.push(this.buildChip(CATEGORY_LABELS[category], counts[category], category));
    }
    this.chipsEl.replaceChildren(...chips);
  }

  private buildChip(label: string, count: number, category: Category | null): HTMLButtonElement {
    const chip = this.doc.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(this.filter === category));
    if (category !== null) {
      chip.style.setProperty('--c', CATEGORY_COLOR[category]);
      const dot = this.doc.createElement('span');
      dot.className = 'dot';
      chip.appendChild(dot);
    }
    const text = this.doc.createElement('span');
    text.textContent = label;
    const n = this.doc.createElement('span');
    n.className = 'n';
    n.textContent = String(count);
    chip.append(text, n);
    chip.addEventListener('click', () => {
      this.filter = this.filter === category ? null : category;
      this.applyFilter();
      this.renderChips();
    });
    return chip;
  }

  private applyFilter(): void {
    for (const [, row] of this.rowByIndex) {
      const hide = this.filter !== null && row.dataset['category'] !== this.filter;
      row.parentElement?.classList.toggle('hidden', hide);
    }
  }
}
