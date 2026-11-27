/**
 * Pure geometry for the landing flow line (design.md "Landing motion
 * identity" items 1-3). Everything here works on numbers measured once by
 * the flow layer; nothing reads layout, so scroll and frame callbacks can
 * call it freely.
 */

/** Content container width (design.md "Spacing and layout"). */
const CONTAINER_WIDTH = 1200;
/** Below this, the dots and the line are hidden: too short to read as flow. */
export const MIN_DOT_RUN = 120;
/** Each dot fades in over its first and out over its last 24 px. */
const DOT_FADE = 24;
/** Tip line: 60% of the viewport height from the top. */
export const TIP_RATIO = 0.6;
const CURVE_SAMPLES = 48;

export type FlowMeasure = {
  /** Width of the flow wrapper (the page width). */
  width: number;
  /** Output handle: bottom centre of the hero product frame, wrapper coordinates. */
  handle: { x: number; y: number };
  /** Bottom edge of the hero section, wrapper coordinates. */
  heroBottom: number;
  /** One entry per section after the hero, in page order. */
  nodes: readonly { id: string; y: number }[];
};

export type FlowNode = { id: string; x: number; y: number; s: number };

export type FlowRoute = {
  d: string;
  total: number;
  railX: number;
  startY: number;
  curveEndY: number;
  endY: number;
  curveLength: number;
  /** Sampled points along the S-curve: x, y, cumulative length. */
  curve: readonly { x: number; y: number; s: number }[];
  nodes: readonly FlowNode[];
};

/**
 * The rail: the middle of the left gutter of the 1200 px container, 8 px from
 * its outer left edge on phones and 16 px from 640 px.
 */
export function railX(width: number): number {
  const containerLeft = Math.max(0, (width - CONTAINER_WIDTH) / 2);
  return containerLeft + (width >= 640 ? 16 : 8);
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Route: from the output handle a vertical S-curve (`M cx,y0 C cx,ym rail,ym
 * rail,y1`) through the hero's bottom padding to the rail, then straight
 * down the rail to the last section node, where it ends.
 */
export function buildRoute(m: FlowMeasure): FlowRoute {
  const rail = railX(m.width);
  const cx = m.handle.x;
  const y0 = m.handle.y;
  const y1 = Math.max(m.heroBottom, y0 + 16);
  const ym = (y0 + y1) / 2;
  const lastNode = m.nodes.length > 0 ? m.nodes[m.nodes.length - 1]!.y : y1;
  const endY = Math.max(lastNode, y1);

  const curve: { x: number; y: number; s: number }[] = [{ x: cx, y: y0, s: 0 }];
  for (let i = 1; i <= CURVE_SAMPLES; i += 1) {
    const t = i / CURVE_SAMPLES;
    const x = cubic(cx, cx, rail, rail, t);
    const y = cubic(y0, ym, ym, y1, t);
    const prev = curve[i - 1]!;
    curve.push({ x, y, s: prev.s + Math.hypot(x - prev.x, y - prev.y) });
  }
  const curveLength = curve[curve.length - 1]!.s;
  const total = curveLength + (endY - y1);

  const nodes = m.nodes.map((node) => {
    const y = Math.min(Math.max(node.y, y1), endY);
    return { id: node.id, x: rail, y, s: curveLength + (y - y1) };
  });

  const d =
    `M ${round(cx)} ${round(y0)} C ${round(cx)} ${round(ym)}, ${round(rail)} ${round(ym)}, ` +
    `${round(rail)} ${round(y1)} L ${round(rail)} ${round(endY)}`;

  return { d, total, railX: rail, startY: y0, curveEndY: y1, endY, curveLength, curve, nodes };
}

/** Path length at a wrapper-relative y (the curve and rail only go down). */
export function lengthAtY(route: FlowRoute, y: number): number {
  if (y <= route.startY) return 0;
  if (y >= route.endY) return route.total;
  if (y >= route.curveEndY) return route.curveLength + (y - route.curveEndY);
  const pts = route.curve;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.y < y) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const f = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
  return a.s + (b.s - a.s) * f;
}

/** Point on the path at length `s` (lookup table plus linear interpolation). */
export function pointAt(route: FlowRoute, s: number): { x: number; y: number } {
  if (s >= route.curveLength) {
    return { x: route.railX, y: Math.min(route.curveEndY + (s - route.curveLength), route.endY) };
  }
  const pts = route.curve;
  if (s <= 0) return { x: pts[0]!.x, y: pts[0]!.y };
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.s < s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const f = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * Node lighting (design.md item 2). A node is lit while the drawn length
 * reaches it. One pulse plays only when exactly one node lights in an
 * update; several at once (anchor jump, deep link, Home/End) light quietly.
 */
export function updateLit(
  prev: readonly boolean[],
  drawn: number,
  nodeLengths: readonly number[],
): { lit: boolean[]; changed: boolean; pulse: number | null } {
  const lit = nodeLengths.map((s) => drawn >= s - 0.5);
  const newly: number[] = [];
  let changed = lit.length !== prev.length;
  lit.forEach((on, i) => {
    if (on !== prev[i]) changed = true;
    if (on && !prev[i]) newly.push(i);
  });
  return { lit, changed, pulse: newly.length === 1 ? newly[0]! : null };
}

export type DotState = { x: number; y: number; opacity: number } | null;

/**
 * Data dot positions (design.md item 3): `count` dots evenly spaced in time
 * travel the visible drawn part, from the viewport top (or the line start)
 * to the drawn end, then restart. `travelled` is the distance covered so far
 * at the dot speed. Shorter than 120 px: no dots.
 */
export function dotPositions(
  route: FlowRoute,
  viewTop: number,
  drawn: number,
  travelled: number,
  count: number,
): DotState[] {
  const start = lengthAtY(route, viewTop);
  const run = drawn - start;
  if (run < MIN_DOT_RUN) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => {
    const along = (travelled + (i * run) / count) % run;
    const s = start + along;
    const opacity = Math.max(0, Math.min(1, along / DOT_FADE, (drawn - s) / DOT_FADE));
    const p = pointAt(route, s);
    return { x: p.x, y: p.y, opacity };
  });
}
