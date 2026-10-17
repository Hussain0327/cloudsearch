/**
 * The procedural SVG spider, ported from `web/components/spider/Spider.tsx`
 * to plain DOM so it can live on any page. Coordinates are viewport pixels:
 * the layer is `position: fixed`, so the spider stays put while the page
 * scrolls under it and the target is re-read every frame.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SpriteColors {
  readonly stroke: string;
  readonly accent: string;
  readonly foot: string;
  readonly body: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LEG_COUNT = 8;
/** Overall size multiplier; 1 is a ~90px leg span. */
const SCALE = 1.25;
const FEMUR = 22 * SCALE;
const TIBIA = 27 * SCALE;
const STEP_THRESHOLD = 18 * SCALE;
const STEP_MS = 120;
/** Tetrapod gait: legs in group A step together, then group B. */
const GROUP_A = new Set([0, 2, 5, 7]);
const TRAIL_LENGTH = 12;

interface LegLayout {
  readonly hip: Point;
  readonly rest: Point;
}

/** Rest foot targets in body space; the spider faces +x. */
const LEG_LAYOUT: readonly LegLayout[] = (() => {
  const spec = [
    {angle: 32, radius: 40, hipX: 6},
    {angle: 66, radius: 38, hipX: 3},
    {angle: 108, radius: 37, hipX: -1},
    {angle: 146, radius: 39, hipX: -4},
  ];
  const out: LegLayout[] = [];
  for (const side of [-1, 1]) {
    for (const s of spec) {
      const a = (side * s.angle * Math.PI) / 180;
      out.push({
        hip: {x: s.hipX * SCALE, y: side * 4.5 * SCALE},
        rest: {x: Math.cos(a) * s.radius * SCALE, y: Math.sin(a) * s.radius * SCALE},
      });
    }
  }
  return out;
})();

interface LegState {
  foot: Point;
  from: Point;
  to: Point;
  stepping: boolean;
  t: number;
}

function rotate(p: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {x: p.x * c - p.y * s, y: p.x * s + p.y * c};
}

function add(a: Point, b: Point): Point {
  return {x: a.x + b.x, y: a.y + b.y};
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** Two-bone IK (law of cosines); the knee bends away from the body centre. */
function solveKnee(hip: Point, foot: Point, body: Point): Point {
  const raw = dist(hip, foot);
  const d = Math.min(Math.max(raw, 0.5), FEMUR + TIBIA - 0.5);
  const base = Math.atan2(foot.y - hip.y, foot.x - hip.x);
  const cosA = (FEMUR * FEMUR + d * d - TIBIA * TIBIA) / (2 * FEMUR * d);
  const a1 = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const k1 = {x: hip.x + Math.cos(base + a1) * FEMUR, y: hip.y + Math.sin(base + a1) * FEMUR};
  const k2 = {x: hip.x + Math.cos(base - a1) * FEMUR, y: hip.y + Math.sin(base - a1) * FEMUR};
  return dist(k1, body) >= dist(k2, body) ? k1 : k2;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  return el;
}

export class SpiderSprite {
  readonly svg: SVGSVGElement;
  private readonly doc: Document;
  private readonly colors: SpriteColors;
  private readonly bodyEl: SVGGElement;
  private readonly draglineEl: SVGLineElement;
  private readonly trailGroup: SVGGElement;
  private readonly legEls: SVGPolylineElement[] = [];
  private readonly kneeEls: SVGCircleElement[] = [];
  private readonly footEls: SVGCircleElement[] = [];

  private pos: Point;
  private vel: Point = {x: 0, y: 0};
  private heading = Math.PI / 2;
  private legs: LegState[] = [];
  private lastGroup = 1;
  private last = 0;
  private raf: number | null = null;
  private active = false;
  private idle: Point;
  /** Re-read every frame so the spider follows a span while the page scrolls. */
  private target: (() => Point | null) | null = null;
  /** Page coordinates of recently visited facts, oldest first. */
  private readonly trail: Point[] = [];
  private readonly reduceMotion: boolean;

  constructor(doc: Document, colors: SpriteColors) {
    this.doc = doc;
    this.colors = colors;
    this.idle = {x: 200, y: 120};
    this.pos = {...this.idle};
    this.reduceMotion =
      typeof doc.defaultView?.matchMedia === 'function' &&
      doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.svg = svgElement(doc, 'svg', {'aria-hidden': 'true'});
    this.svg.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;' +
      'z-index:2147483647;';

    this.trailGroup = svgElement(doc, 'g', {});
    this.svg.appendChild(this.trailGroup);
    this.draglineEl = svgElement(doc, 'line', {
      stroke: colors.stroke,
      'stroke-width': '1',
      'stroke-opacity': '0.28',
    });
    this.svg.appendChild(this.draglineEl);

    for (let i = 0; i < LEG_COUNT; i++) {
      const g = svgElement(doc, 'g', {});
      const leg = svgElement(doc, 'polyline', {
        fill: 'none',
        stroke: colors.stroke,
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      const knee = svgElement(doc, 'circle', {r: '1.6', fill: colors.stroke});
      const foot = svgElement(doc, 'circle', {r: '1.9', fill: colors.foot});
      g.append(leg, knee, foot);
      this.svg.appendChild(g);
      this.legEls.push(leg);
      this.kneeEls.push(knee);
      this.footEls.push(foot);
    }

    this.bodyEl = svgElement(doc, 'g', {});
    const scaled = svgElement(doc, 'g', {transform: `scale(${SCALE})`});
    scaled.append(
      svgElement(doc, 'ellipse', {
        cx: '-9', cy: '0', rx: '11', ry: '6.5',
        fill: colors.body, stroke: colors.stroke, 'stroke-width': '1.2',
      }),
      svgElement(doc, 'ellipse', {
        cx: '3', cy: '0', rx: '6', ry: '5',
        fill: colors.body, stroke: colors.stroke, 'stroke-width': '1.2',
      }),
      svgElement(doc, 'circle', {cx: '6.5', cy: '-1.6', r: '1.1', fill: colors.accent}),
      svgElement(doc, 'circle', {cx: '6.5', cy: '1.6', r: '1.1', fill: colors.accent}),
      svgElement(doc, 'circle', {cx: '-9', cy: '0', r: '2.2', fill: colors.accent, 'fill-opacity': '0.9'}),
    );
    this.bodyEl.appendChild(scaled);
    this.svg.appendChild(this.bodyEl);

    this.plantFeet();
  }

  setIdle(point: Point): void {
    this.idle = point;
  }

  setTarget(target: (() => Point | null) | null): void {
    this.target = target;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Records a visited point in page coordinates for the silk trail. */
  pushTrail(pagePoint: Point): void {
    this.trail.push(pagePoint);
    if (this.trail.length > TRAIL_LENGTH) {
      this.trail.shift();
    }
  }

  clearTrail(): void {
    this.trail.length = 0;
    this.trailGroup.replaceChildren();
  }

  /** Snaps the body to the idle point and plants the feet. */
  rest(): void {
    this.pos = {...this.idle};
    this.vel = {x: 0, y: 0};
    this.plantFeet();
  }

  start(): void {
    if (this.raf !== null) {
      return;
    }
    const view = this.doc.defaultView;
    if (!view) {
      return;
    }
    const loop = (now: number): void => {
      this.step(now);
      this.raf = view.requestAnimationFrame(loop);
    };
    this.raf = view.requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) {
      this.doc.defaultView?.cancelAnimationFrame(this.raf);
      this.raf = null;
      this.last = 0;
    }
  }

  private plantFeet(): void {
    this.legs = LEG_LAYOUT.map((l) => {
      const foot = add(this.pos, rotate(l.rest, this.heading));
      return {foot, from: foot, to: foot, stepping: false, t: 1};
    });
  }

  private step(now: number): void {
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    const goal = this.target?.() ?? this.idle;

    if (this.reduceMotion) {
      if (dist(this.pos, goal) > 0.5) {
        this.pos = {...goal};
        this.vel = {x: 0, y: 0};
        this.plantFeet();
      }
      this.paint();
      return;
    }

    // Critically damped spring toward the goal.
    const k = 110;
    const c = 2 * Math.sqrt(k);
    const ax = k * (goal.x - this.pos.x) - c * this.vel.x;
    const ay = k * (goal.y - this.pos.y) - c * this.vel.y;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Idle breathing so a resting spider still looks alive.
    if (!this.target || !this.active) {
      this.pos.y += Math.sin(now / 420) * 0.08;
    }

    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > 6) {
      this.heading = lerpAngle(
        this.heading,
        Math.atan2(this.vel.y, this.vel.x),
        Math.min(1, dt * 9),
      );
    }

    let anyStepping = false;
    for (const leg of this.legs) {
      if (!leg.stepping) continue;
      leg.t = Math.min(1, leg.t + (dt * 1000) / STEP_MS);
      if (leg.t >= 1) {
        leg.stepping = false;
        leg.foot = leg.to;
      } else {
        anyStepping = true;
      }
    }

    // A foot left impossibly far behind (a jump across the page) snaps.
    this.legs.forEach((leg, i) => {
      const layout = LEG_LAYOUT[i];
      if (!layout) return;
      const hip = add(this.pos, rotate(layout.hip, this.heading));
      if (!leg.stepping && dist(leg.foot, hip) > (FEMUR + TIBIA) * 1.6) {
        leg.foot = add(this.pos, rotate(layout.rest, this.heading));
      }
    });

    if (!anyStepping) {
      const lead = {x: this.vel.x * 0.09, y: this.vel.y * 0.09};
      const restOf = (i: number): Point => {
        const layout = LEG_LAYOUT[i];
        return layout ? add(this.pos, rotate(layout.rest, this.heading)) : this.pos;
      };
      const drift = (i: number): number => {
        const leg = this.legs[i];
        return leg ? dist(leg.foot, restOf(i)) : 0;
      };
      const groups: number[][] = [[], []];
      for (let i = 0; i < LEG_COUNT; i++) {
        groups[GROUP_A.has(i) ? 0 : 1]?.push(i);
      }
      const order = this.lastGroup === 0 ? [1, 0] : [0, 1];
      for (const g of order) {
        const legs = groups[g] ?? [];
        if (!legs.some((i) => drift(i) > STEP_THRESHOLD)) continue;
        for (const i of legs) {
          const leg = this.legs[i];
          if (!leg || drift(i) < 4) continue;
          leg.stepping = true;
          leg.t = 0;
          leg.from = leg.foot;
          leg.to = add(restOf(i), lead);
        }
        this.lastGroup = g;
        break;
      }
    }

    this.paint();
  }

  private paint(): void {
    const deg = (this.heading * 180) / Math.PI;
    this.bodyEl.setAttribute('transform', `translate(${this.pos.x} ${this.pos.y}) rotate(${deg})`);
    this.draglineEl.setAttribute('x1', String(this.pos.x));
    this.draglineEl.setAttribute('y1', String(this.pos.y));
    this.draglineEl.setAttribute('x2', String(this.pos.x));
    this.draglineEl.setAttribute('y2', '0');

    this.legs.forEach((leg, i) => {
      const layout = LEG_LAYOUT[i];
      if (!layout) return;
      const hip = add(this.pos, rotate(layout.hip, this.heading));
      let foot = leg.foot;
      if (leg.stepping) {
        const k = easeInOut(leg.t);
        foot = {
          x: leg.from.x + (leg.to.x - leg.from.x) * k,
          y: leg.from.y + (leg.to.y - leg.from.y) * k,
        };
      }
      const knee = solveKnee(hip, foot, this.pos);
      this.legEls[i]?.setAttribute('points', `${hip.x},${hip.y} ${knee.x},${knee.y} ${foot.x},${foot.y}`);
      this.kneeEls[i]?.setAttribute('cx', String(knee.x));
      this.kneeEls[i]?.setAttribute('cy', String(knee.y));
      const f = this.footEls[i];
      if (f) {
        f.setAttribute('cx', String(foot.x));
        f.setAttribute('cy', String(foot.y));
        f.setAttribute('r', leg.stepping ? '2.6' : '1.9');
      }
    });

    this.paintTrail();
  }

  private paintTrail(): void {
    const view = this.doc.defaultView;
    const sx = view?.scrollX ?? 0;
    const sy = view?.scrollY ?? 0;
    const segments: SVGLineElement[] = [];
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (!a || !b) continue;
      segments.push(
        svgElement(this.doc, 'line', {
          x1: String(a.x - sx),
          y1: String(a.y - sy),
          x2: String(b.x - sx),
          y2: String(b.y - sy),
          stroke: this.colors.stroke,
          'stroke-width': '1',
          'stroke-opacity': String(0.08 + (0.32 * i) / this.trail.length),
          'stroke-dasharray': '3 3',
        }),
      );
    }
    this.trailGroup.replaceChildren(...segments);
  }
}
