import { afterEach, describe, expect, it, vi } from "vitest";

import { ALLOWED_NODE_TYPES } from "@/lib/n8n-catalog/allowlist";
import { FACTS, FAQ, HOW_IT_WORKS } from "@/features/marketing/copy";
import { createDotLoop } from "@/features/marketing/dot-loop";
import {
  buildRoute,
  dotPositions,
  lengthAtY,
  MIN_DOT_RUN,
  pointAt,
  railX,
  updateLit,
  type FlowMeasure,
} from "@/features/marketing/flow-geometry";
import { PREVIEW_EDGES, PREVIEW_NODES } from "@/features/marketing/preview-data";

const MEASURE: FlowMeasure = {
  width: 1440,
  handle: { x: 720, y: 1100 },
  heroBottom: 1230,
  nodes: [
    { id: "how-it-works", y: 1340 },
    { id: "features", y: 4350 },
    { id: "get-started", y: 8060 },
  ],
};

describe("flow route (design.md item 1)", () => {
  it("puts the rail in the middle of the container's left gutter", () => {
    expect(railX(1440)).toBe(120 + 16);
    expect(railX(1200)).toBe(16);
    expect(railX(390)).toBe(8);
    expect(railX(640)).toBe(16);
  });

  it("runs from the output handle through an S-curve to the rail and ends at the last node", () => {
    const route = buildRoute(MEASURE);
    expect(route.d).toBe("M 720 1100 C 720 1165, 136 1165, 136 1230 L 136 8060");
    expect(route.railX).toBe(136);
    expect(route.total).toBeCloseTo(route.curveLength + (8060 - 1230), 6);
    expect(route.nodes.map((n) => n.x)).toEqual([136, 136, 136]);
    expect(route.nodes.map((n) => n.s)).toEqual([
      route.curveLength + 110,
      route.curveLength + 3120,
      route.curveLength + 6830,
    ]);
  });

  it("maps a page y to a length and back (lookup table)", () => {
    const route = buildRoute(MEASURE);
    expect(lengthAtY(route, 0)).toBe(0);
    expect(lengthAtY(route, 99999)).toBe(route.total);
    for (const y of [1120, 1165, 1229, 1500, 5000]) {
      const point = pointAt(route, lengthAtY(route, y));
      expect(point.y).toBeCloseTo(y, 0);
    }
    expect(pointAt(route, 0)).toEqual({ x: 720, y: 1100 });
    expect(pointAt(route, route.total)).toEqual({ x: 136, y: 8060 });
  });
});

describe("M10 g: node lighting and the pulse rule", () => {
  const lengths = [100, 200, 300];

  it("one node lighting gives one pulse", () => {
    const result = updateLit([false, false, false], 150, lengths);
    expect(result).toEqual({ lit: [true, false, false], changed: true, pulse: 0 });
  });

  it("three nodes lighting in one update (anchor jump) give no pulse", () => {
    const result = updateLit([false, false, false], 999, lengths);
    expect(result.lit).toEqual([true, true, true]);
    expect(result.pulse).toBeNull();
  });

  it("nodes unlight when the line retreats, without a pulse", () => {
    const result = updateLit([true, true, false], 120, lengths);
    expect(result).toEqual({ lit: [true, false, false], changed: true, pulse: null });
    expect(updateLit([true, false, false], 130, lengths).changed).toBe(false);
  });
});

describe("M4: data dots", () => {
  const route = buildRoute(MEASURE);

  it("travel the visible drawn part, evenly spaced, with fades at both ends", () => {
    const viewTop = 2000;
    const drawn = lengthAtY(route, 2540);
    const dots = dotPositions(route, viewTop, drawn, 0, 4);
    expect(dots).toHaveLength(4);
    const ys = dots.map((d) => d!.y);
    expect(ys[0]).toBeCloseTo(2000, 0);
    expect(ys[1]! - ys[0]!).toBeCloseTo(135, 0);
    expect(dots[0]!.opacity).toBe(0);
    expect(dots[1]!.opacity).toBe(1);
    for (const d of dots) expect(d!.x).toBe(136);
    // 160 px later every dot has moved 160 px down (wrapping at the drawn end).
    const later = dotPositions(route, viewTop, drawn, 160, 4);
    expect(later[0]!.y).toBeCloseTo(2160, 0);
  });

  it("show nothing when the visible drawn part is shorter than 120 px", () => {
    const drawn = lengthAtY(route, 2000 + MIN_DOT_RUN - 1);
    expect(dotPositions(route, 2000, drawn, 0, 2)).toEqual([null, null]);
  });
});

describe("M10 f: the dot loop pauses while the tab is hidden", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules no frames while hidden and resumes when visible", () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const queue: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      queue.push(cb);
      return queue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const runFrame = () => queue.shift()?.(performance.now());

    const onFrame = vi.fn(() => true);
    const loop = createDotLoop(onFrame);
    loop.start();
    runFrame();
    runFrame();
    expect(onFrame).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    const scheduled = raf.mock.calls.length;
    queue.length = 0;
    loop.start();
    expect(raf.mock.calls.length).toBe(scheduled);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(raf.mock.calls.length).toBe(scheduled + 1);
    runFrame();
    expect(onFrame).toHaveBeenCalledTimes(3);
    loop.destroy();
  });

  it("stops by itself when there is nothing to draw, and start() resumes it", () => {
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      queue.push(cb);
      return queue.length;
    });
    const loop = createDotLoop(() => false);
    loop.start();
    queue.shift()?.(0);
    expect(queue).toHaveLength(0);
    loop.start();
    expect(queue).toHaveLength(1);
    loop.destroy();
  });
});

describe("Review fixes in copy and sample data", () => {
  it("RL-10: every '32' in the copy equals the generated allow list size", () => {
    const strings = [FACTS[2].label, HOW_IT_WORKS.steps[3].body, FAQ.items[6].a];
    for (const s of strings) {
      const counts = s.match(/\b\d+\b/g)?.map(Number) ?? [];
      expect(counts, s).toEqual([ALLOWED_NODE_TYPES.length]);
    }
  });

  it("RL-9: both branches of the sample graph reply to the webhook caller", () => {
    const keys = PREVIEW_NODES.map((n) => n.key);
    const next = (key: string) => PREVIEW_EDGES.filter((e) => e.from === key).map((e) => e.to);
    for (const branch of next("if")) {
      const seen = new Set<string>();
      const queue = [branch];
      while (queue.length > 0) {
        const key = queue.shift()!;
        seen.add(key);
        queue.push(...next(key));
      }
      expect(seen.has("respond"), branch).toBe(true);
    }
    for (const edge of PREVIEW_EDGES) {
      expect(keys).toContain(edge.from);
      expect(keys).toContain(edge.to);
    }
  });
});
