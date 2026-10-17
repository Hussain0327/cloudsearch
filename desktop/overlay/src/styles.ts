/** Colours and CSS for the highlights (in the page) and the panel (in a shadow root). */

import type {Category} from './types';

export const CATEGORY_COLOR: Readonly<Record<Category, string>> = {
  revenue: '#46c46a',
  debt: '#f5a623',
  shares: '#e879a6',
  other: '#8b95a7',
  custom: '#3dd6d0',
};

export const PALETTE = {
  background: '#0b0e14',
  raised: '#151a23',
  hairline: 'rgba(154, 164, 182, 0.18)',
  text: '#e6e9ef',
  textSecondary: '#9aa4b6',
  textMuted: '#5c6678',
  cyan: '#3dd6d0',
  accent: '#f5a623',
  success: '#46c46a',
} as const;

/** Injected into the page's `<head>`; styles the wrapped fact spans. */
export const HIGHLIGHT_CSS = `
.cs-fact {
  --cs-cat: ${CATEGORY_COLOR.other};
  border-radius: 2px;
  padding: 0 1px;
  transition: background-color 220ms ease, box-shadow 220ms ease;
}
.cs-fact[data-category="revenue"] { --cs-cat: ${CATEGORY_COLOR.revenue}; }
.cs-fact[data-category="debt"] { --cs-cat: ${CATEGORY_COLOR.debt}; }
.cs-fact[data-category="shares"] { --cs-cat: ${CATEGORY_COLOR.shares}; }
.cs-fact[data-category="other"] { --cs-cat: ${CATEGORY_COLOR.other}; }
.cs-fact[data-category="custom"] { --cs-cat: ${CATEGORY_COLOR.custom}; }
.cs-fact.cs-fact--hit {
  background-color: color-mix(in srgb, var(--cs-cat) 22%, transparent) !important;
  box-shadow: 0 0 0 1.5px var(--cs-cat) !important;
}
.cs-fact.cs-fact--current {
  background-color: color-mix(in srgb, var(--cs-cat) 34%, transparent) !important;
  box-shadow: 0 0 0 2px var(--cs-cat), 0 0 0 6px color-mix(in srgb, var(--cs-cat) 25%, transparent) !important;
}
@keyframes cs-pulse {
  0% { box-shadow: 0 0 0 2px var(--cs-cat), 0 0 0 2px color-mix(in srgb, var(--cs-cat) 60%, transparent); }
  60% { box-shadow: 0 0 0 2px var(--cs-cat), 0 0 0 14px color-mix(in srgb, var(--cs-cat) 0%, transparent); }
  100% { box-shadow: 0 0 0 1.5px var(--cs-cat); }
}
.cs-fact.cs-fact--pulse { animation: cs-pulse 700ms ease-out; }
`;

/** Lives inside the panel's shadow root, so page CSS cannot reach it. */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
  position: fixed; top: 16px; right: 16px; bottom: 16px; width: 300px;
  display: flex; flex-direction: column;
  background: rgba(11, 14, 20, 0.86); color: ${PALETTE.text};
  border: 1px solid ${PALETTE.hairline}; border-radius: 10px;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  z-index: 2147483646; overflow: hidden;
}
.panel.collapsed { bottom: auto; }
.panel.collapsed .chips, .panel.collapsed .rows { display: none; }
.header {
  display: flex; align-items: baseline; gap: 8px; padding: 10px 12px 8px;
  border-bottom: 1px solid ${PALETTE.hairline};
}
.title { font-weight: 700; font-size: 15px; color: ${PALETTE.success}; letter-spacing: 0.01em; }
.count { margin-left: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: ${PALETTE.textSecondary}; font-variant-numeric: tabular-nums; }
.toggle {
  all: unset; cursor: pointer; color: ${PALETTE.textSecondary}; font-size: 11px; padding: 0 4px;
}
.toggle:hover { color: ${PALETTE.text}; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid ${PALETTE.hairline}; }
.chip {
  all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 22px;
  padding: 0 8px; border-radius: 999px; border: 1px solid ${PALETTE.hairline};
  color: ${PALETTE.textSecondary}; font-size: 11px;
}
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c); }
.chip .n { font-family: ui-monospace, "SF Mono", Menlo, monospace; opacity: 0.85; font-variant-numeric: tabular-nums; }
.chip[aria-pressed="true"] { border-color: var(--c, ${PALETTE.text}); color: ${PALETTE.text}; background: ${PALETTE.raised}; }
.rows { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px; margin: 0; list-style: none; }
.empty { padding: 24px 8px; color: ${PALETTE.textMuted}; }
.row {
  all: unset; cursor: pointer; display: grid; grid-template-columns: 3px minmax(0, 1fr) auto;
  align-items: center; column-gap: 10px; width: 100%; padding: 6px 8px; border-radius: 4px;
}
.row:hover { background: rgba(21, 26, 35, 0.9); }
.row[aria-current="true"] { background: ${PALETTE.raised}; }
.bar { width: 3px; min-height: 26px; height: 100%; border-radius: 2px; background: var(--c); }
.main { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.value { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; font-weight: 500; color: ${PALETTE.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.label { color: ${PALETTE.textSecondary}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 30%; }
.cat { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px; color: var(--c); text-transform: uppercase; letter-spacing: 0.04em; }
.hidden { display: none !important; }
`;
