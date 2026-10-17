"use client";

import * as React from "react";

/** A point in the overlay's coordinate space (CSS px, origin top-left). */
export interface Point {
  x: number;
  y: number;
}

export interface SpiderProps {
  /** Where the spider should walk to, in container coordinates. */
  target: Point | null;
  /** Where the spider rests before any target exists. */
  idle: Point;
  /** False freezes the walk cycle (paused / done). The pose is kept. */
  active: boolean;
  /** Recently visited points, oldest first; drawn as fading silk. */
  trail?: Point[];
  className?: string;
}

/* ------------------------------------------------------------------------ */
/* Geometry                                                                 */
/* ------------------------------------------------------------------------ */

const LEG_COUNT = 8;
/** Overall size multiplier; 1 is a ~90px leg span. */
const SCALE = 1.25;
const FEMUR = 22 * SCALE;
const TIBIA = 27 * SCALE;
const STEP_THRESHOLD = 18 * SCALE;
const STEP_MS = 120;
/** Tetrapod gait: legs in group A step together, then group B. */
const GROUP_A = new Set([0, 2, 5, 7]);

/** Rest foot targets in body space; the spider faces +x. Index 0..3 left, 4..7 right. */
const LEG_LAYOUT: { hip: Point; rest: Point }[] = (() => {
  // Per-side (front -> back): angle from heading, rest radius, hip offset along body.
  const spec: { angle: number; radius: number; hipX: number }[] = [
    { angle: 32, radius: 40, hipX: 6 },
    { angle: 66, radius: 38, hipX: 3 },
    { angle: 108, radius: 37, hipX: -1 },
    { angle: 146, radius: 39, hipX: -4 },
  ];
  const out: { hip: Point; rest: Point }[] = [];
  for (const side of [-1, 1] as const) {
    for (const s of spec) {
      const a = (side * s.angle * Math.PI) / 180;
      out.push({
        hip: { x: s.hipX * SCALE, y: side * 4.5 * SCALE },
        rest: { x: Math.cos(a) * s.radius * SCALE, y: Math.sin(a) * s.radius * SCALE },
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

function rotate(p: Point, ang: number): Point {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
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

/**
 * Two-bone IK (law of cosines). Returns the knee such that the leg bends
 * away from the body centre, which reads as a top-down spider.
 */
function solveKnee(hip: Point, foot: Point, body: Point): Point {
  const raw = dist(hip, foot);
  const d = Math.min(Math.max(raw, 0.5), FEMUR + TIBIA - 0.5);
  const base = Math.atan2(foot.y - hip.y, foot.x - hip.x);
  const cosA = (FEMUR * FEMUR + d * d - TIBIA * TIBIA) / (2 * FEMUR * d);
  const a1 = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const k1 = { x: hip.x + Math.cos(base + a1) * FEMUR, y: hip.y + Math.sin(base + a1) * FEMUR };
  const k2 = { x: hip.x + Math.cos(base - a1) * FEMUR, y: hip.y + Math.sin(base - a1) * FEMUR };
  return dist(k1, body) >= dist(k2, body) ? k1 : k2;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/* ------------------------------------------------------------------------ */
/* Component                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Procedural SVG spider. Positions are integrated in requestAnimationFrame and
 * written straight to the DOM (no React state per frame). The body follows
 * `target` with a critically damped spring; feet stay planted on the page and
 * step in alternating tetrapod groups when their rest target drifts too far.
 */
export function Spider({ target, idle, active, trail = [], className }: SpiderProps) {
  const legRefs = React.useRef<(SVGPolylineElement | null)[]>([]);
  const kneeRefs = React.useRef<(SVGCircleElement | null)[]>([]);
  const footRefs = React.useRef<(SVGCircleElement | null)[]>([]);
  const bodyRef = React.useRef<SVGGElement | null>(null);
  const draglineRef = React.useRef<SVGLineElement | null>(null);

  // Simulation state lives in refs so the rAF loop never re-renders React.
  const sim = React.useRef<{
    pos: Point;
    vel: Point;
    heading: number;
    legs: LegState[];
    target: Point | null;
    idle: Point;
    active: boolean;
    reduce: boolean;
    last: number;
    raf: number | null;
    initialized: boolean;
    lastGroup: number;
  }>({
    pos: idle,
    vel: { x: 0, y: 0 },
    heading: Math.PI / 2,
    legs: [],
    target,
    idle,
    active,
    reduce: false,
    last: 0,
    raf: null,
    initialized: false,
    lastGroup: 1,
  });

  // Keep the latest props visible to the loop without restarting it.
  React.useEffect(() => {
    sim.current.target = target;
    sim.current.idle = idle;
    sim.current.active = active;
  }, [target, idle, active]);

  React.useEffect(() => {
    const s = sim.current;
    s.reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!s.initialized) {
      s.pos = { ...s.idle };
      s.legs = LEG_LAYOUT.map((l) => {
        const foot = add(s.pos, rotate(l.rest, s.heading));
        return { foot, from: foot, to: foot, stepping: false, t: 1 };
      });
      s.initialized = true;
    }

    const paint = () => {
      const bodyEl = bodyRef.current;
      if (bodyEl) {
        const deg = (s.heading * 180) / Math.PI;
        bodyEl.setAttribute("transform", `translate(${s.pos.x} ${s.pos.y}) rotate(${deg})`);
      }
      const dl = draglineRef.current;
      if (dl) {
        dl.setAttribute("x1", String(s.pos.x));
        dl.setAttribute("y1", String(s.pos.y));
        dl.setAttribute("x2", String(s.pos.x));
        dl.setAttribute("y2", "0");
      }
      for (let i = 0; i < LEG_COUNT; i++) {
        const layout = LEG_LAYOUT[i];
        const leg = s.legs[i];
        const hip = add(s.pos, rotate(layout.hip, s.heading));
        // Mid-step the foot lifts along an eased path with a slight arc.
        let foot = leg.foot;
        if (leg.stepping) {
          const k = easeInOut(leg.t);
          foot = {
            x: leg.from.x + (leg.to.x - leg.from.x) * k,
            y: leg.from.y + (leg.to.y - leg.from.y) * k,
          };
        }
        const knee = solveKnee(hip, foot, s.pos);
        legRefs.current[i]?.setAttribute(
          "points",
          `${hip.x},${hip.y} ${knee.x},${knee.y} ${foot.x},${foot.y}`,
        );
        kneeRefs.current[i]?.setAttribute("cx", String(knee.x));
        kneeRefs.current[i]?.setAttribute("cy", String(knee.y));
        const f = footRefs.current[i];
        if (f) {
          f.setAttribute("cx", String(foot.x));
          f.setAttribute("cy", String(foot.y));
          f.setAttribute("r", leg.stepping ? "2.6" : "1.9");
        }
      }
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, s.last ? (now - s.last) / 1000 : 0.016);
      s.last = now;

      const goal = s.target ?? s.idle;

      if (s.reduce) {
        // Snap instead of tweening.
        if (dist(s.pos, goal) > 0.5) {
          s.pos = { ...goal };
          s.vel = { x: 0, y: 0 };
          for (let i = 0; i < LEG_COUNT; i++) {
            const foot = add(s.pos, rotate(LEG_LAYOUT[i].rest, s.heading));
            s.legs[i] = { foot, from: foot, to: foot, stepping: false, t: 1 };
          }
        }
      } else {
        // Critically damped spring toward the goal.
        const k = 110;
        const c = 2 * Math.sqrt(k);
        const ax = k * (goal.x - s.pos.x) - c * s.vel.x;
        const ay = k * (goal.y - s.pos.y) - c * s.vel.y;
        s.vel.x += ax * dt;
        s.vel.y += ay * dt;
        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;

        // Idle breathing: a tiny bob so a resting spider still looks alive.
        if (!s.target || !s.active) {
          s.pos.y += Math.sin(now / 420) * 0.08;
        }

        const speed = Math.hypot(s.vel.x, s.vel.y);
        if (speed > 6) {
          s.heading = lerpAngle(s.heading, Math.atan2(s.vel.y, s.vel.x), Math.min(1, dt * 9));
        }

        // Gait: advance in-flight steps.
        let anyStepping = false;
        for (let i = 0; i < LEG_COUNT; i++) {
          const leg = s.legs[i];
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
        for (let i = 0; i < LEG_COUNT; i++) {
          const leg = s.legs[i];
          const hip = add(s.pos, rotate(LEG_LAYOUT[i].hip, s.heading));
          if (!leg.stepping && dist(leg.foot, hip) > (FEMUR + TIBIA) * 1.6) {
            leg.foot = add(s.pos, rotate(LEG_LAYOUT[i].rest, s.heading));
          }
        }

        // When no leg is in flight, the group opposite the last one steps if
        // any of its feet has drifted; otherwise the other group may. Strict
        // alternation prevents one group from starving the other.
        if (!anyStepping) {
          const lead = { x: s.vel.x * 0.09, y: s.vel.y * 0.09 };
          const drift = (i: number) =>
            dist(s.legs[i].foot, add(s.pos, rotate(LEG_LAYOUT[i].rest, s.heading)));
          const groups: number[][] = [[], []];
          for (let i = 0; i < LEG_COUNT; i++) groups[GROUP_A.has(i) ? 0 : 1].push(i);
          const order = s.lastGroup === 0 ? [1, 0] : [0, 1];
          for (const g of order) {
            const legs = groups[g];
            if (!legs.some((i) => drift(i) > STEP_THRESHOLD)) continue;
            for (const i of legs) {
              // Move the whole group so the gait reads as coordinated, but only
              // legs that have actually drifted a little.
              if (drift(i) < 4) continue;
              const leg = s.legs[i];
              leg.stepping = true;
              leg.t = 0;
              leg.from = leg.foot;
              leg.to = add(add(s.pos, rotate(LEG_LAYOUT[i].rest, s.heading)), lead);
            }
            s.lastGroup = g;
            break;
          }
        }
      }

      paint();
      s.raf = requestAnimationFrame(step);
    };

    s.raf = requestAnimationFrame(step);
    return () => {
      if (s.raf !== null) cancelAnimationFrame(s.raf);
      s.raf = null;
      s.last = 0;
    };
    // The loop reads props through sim.current, so it mounts once.
  }, []);

  const legIndices = React.useMemo(() => Array.from({ length: LEG_COUNT }, (_, i) => i), []);

  // Silk trail: short segments with decreasing opacity toward the oldest.
  const silk = React.useMemo(() => {
    const pts = trail.slice(-12);
    const segs: { a: Point; b: Point; o: number }[] = [];
    for (let i = 1; i < pts.length; i++) {
      segs.push({ a: pts[i - 1], b: pts[i], o: 0.08 + (0.32 * i) / pts.length });
    }
    return segs;
  }, [trail]);

  return (
    <svg
      className={className}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {/* Silk trail through recent facts. */}
      {silk.map((seg, i) => (
        <line
          key={i}
          x1={seg.a.x}
          y1={seg.a.y}
          x2={seg.b.x}
          y2={seg.b.y}
          stroke="var(--cyan)"
          strokeWidth={1}
          strokeOpacity={seg.o}
          strokeDasharray="3 3"
        />
      ))}
      {/* Dragline up to the top of the page. */}
      <line
        ref={draglineRef}
        stroke="var(--cyan)"
        strokeWidth={1}
        strokeOpacity={0.28}
      />
      {/* Legs */}
      {legIndices.map((i) => (
        <g key={i}>
          <polyline
            ref={(el) => {
              legRefs.current[i] = el;
            }}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            ref={(el) => {
              kneeRefs.current[i] = el;
            }}
            r={1.6}
            fill="var(--cyan)"
          />
          <circle
            ref={(el) => {
              footRefs.current[i] = el;
            }}
            r={1.9}
            fill="var(--cat-shares)"
          />
        </g>
      ))}
      {/* Body: abdomen behind, cephalothorax in front, facing +x. */}
      <g ref={bodyRef}>
        <g transform={`scale(${SCALE})`}>
          <ellipse cx={-9} cy={0} rx={11} ry={6.5} fill="#0b0e14" stroke="var(--cyan)" strokeWidth={1.2} />
          <ellipse cx={3} cy={0} rx={6} ry={5} fill="#0b0e14" stroke="var(--cyan)" strokeWidth={1.2} />
          <circle cx={6.5} cy={-1.6} r={1.1} fill="var(--accent)" />
          <circle cx={6.5} cy={1.6} r={1.1} fill="var(--accent)" />
          <circle cx={-9} cy={0} r={2.2} fill="var(--accent)" fillOpacity={0.9} />
        </g>
      </g>
    </svg>
  );
}
