/**
 * Client-side helpers for turning a filing's annotated HTML into something we
 * can safely inject into the viewer, and for locating fact spans in it.
 */

const SCOPE = ".cs-doc";

/**
 * Prefix every selector in a <style> rule list with the .cs-doc scope so the
 * filing's own stylesheet (if any) cannot restyle the app shell. `html` and
 * `body` selectors are mapped onto the scope root itself.
 */
function scopeStyleText(cssText: string): string {
  if (typeof document === "undefined") return cssText;
  const probe = document.createElement("style");
  probe.textContent = cssText;
  document.head.appendChild(probe);
  const out: string[] = [];
  try {
    const sheet = probe.sheet;
    if (!sheet) return cssText;
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule) {
        rule.selectorText = rule.selectorText
          .split(",")
          .map((sel) => {
            const s = sel.trim();
            if (/^(html|body)(\s|$|[.:#\[])/i.test(s)) {
              return s.replace(/^(html|body)/i, SCOPE);
            }
            return `${SCOPE} ${s}`;
          })
          .join(", ");
        out.push(rule.cssText);
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        // Nested grouping rules: scope their inner rules recursively.
        const inner = Array.from(rule.cssRules)
          .map((r) => r.cssText)
          .join("\n");
        out.push(`${rule.cssText.split("{")[0]}{${scopeStyleText(inner)}}`);
      } else if (rule instanceof CSSFontFaceRule || rule instanceof CSSKeyframesRule) {
        out.push(rule.cssText);
      }
      // @import and friends are dropped on purpose.
    }
  } catch {
    return "";
  } finally {
    probe.remove();
  }
  return out.join("\n");
}

/**
 * Accepts either a full HTML document or a fragment and returns a body
 * fragment with any <style> blocks scoped to .cs-doc and all scripts removed.
 * The server already sanitizes; this is defense in depth for the renderer.
 */
export function prepareFilingHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.querySelectorAll("script, iframe, object, embed, link, meta, base").forEach((n) =>
    n.remove(),
  );
  // Strip inline event handlers and javascript: URLs.
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  const styles: string[] = [];
  doc.querySelectorAll("style").forEach((s) => {
    styles.push(scopeStyleText(s.textContent ?? ""));
    s.remove();
  });

  const body = doc.body?.innerHTML ?? html;
  const styleBlock = styles.length ? `<style>${styles.join("\n")}</style>` : "";
  return styleBlock + body;
}

/** Find the span for a fact id inside the stage. */
export function findFactElement(root: ParentNode, domId: string): HTMLElement | null {
  // dom ids are f-00042; attribute selector keeps us safe from odd ids.
  const safe = domId.replace(/["\\]/g, "");
  return root.querySelector<HTMLElement>(`[data-fact-id="${safe}"]`);
}

/** Centre-top of an element relative to a positioned container. */
export function anchorPoint(el: HTMLElement, container: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { x: r.left - c.left + r.width / 2, y: r.top - c.top + Math.min(6, r.height / 2) };
}

/** Nearest ancestor that actually scrolls vertically (or null for the window). */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Centre `el` inside its own scroll container without touching the window
 * (scrollIntoView would also nudge the page when the footer overflows).
 */
export function scrollToWithin(el: HTMLElement, behavior: ScrollBehavior): void {
  const container = scrollParent(el);
  if (!container) {
    el.scrollIntoView({ block: "center", behavior });
    return;
  }
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const top = container.scrollTop + (r.top - c.top) - c.height / 2 + r.height / 2;
  container.scrollTo({ top: Math.max(0, top), behavior });
}
