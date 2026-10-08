// Boolean toolkit over flattened polygons (polyclip-ts), stroke outlining, mark
// measurement, and the `boolean` generator: two primitives and one operation.
import * as pc from "polyclip-ts";
import { pathFromPoints, bbox } from "../../lib/svg.mjs";
import { flattenPath, ringArea, ringCentroid, circlePath, regularPolygon, dist, PHI } from "../geom.mjs";

export const FLATTEN_TOL = 0.25;
const snap = (v) => Math.round(v * 1e4) / 1e4;
const closeRing = (pts) => {
  const r = pts.map(([x, y]) => [snap(x), snap(y)]);
  const [a, b] = [r[0], r.at(-1)];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([...a]);
  return r;
};

const isGeom = (x) => Array.isArray(x);

// d string | element {d, fillRule} | polyclip geometry → MultiPolygon.
export function toGeom(input, fillRule) {
  if (isGeom(input)) return input;
  const d = typeof input === "string" ? input : input.d;
  const rule = fillRule ?? (typeof input === "object" ? input.fillRule : undefined) ?? "nonzero";
  const rings = flattenPath(d, FLATTEN_TOL).map((r) => r.points).filter((p) => p.length >= 3 && Math.abs(ringArea(p)) > 1e-6);
  if (!rings.length) return [];
  const polys = rings.map((r) => [closeRing(r)]);
  if (rule === "evenodd") return polys.length === 1 ? pc.union(polys[0]) : pc.xor(...polys);
  const pos = polys.filter((_, i) => ringArea(rings[i]) > 0), neg = polys.filter((_, i) => ringArea(rings[i]) < 0);
  if (!pos.length || !neg.length) return pc.union(...polys);
  return pc.difference(pc.union(...pos), pc.union(...neg));
}

export function fromGeom(geom) {
  return geom.flatMap((poly) => poly.map((ring) => pathFromPoints(ring.slice(0, -1)))).join("");
}

const clean = (g) => g.filter((poly) => poly.length && Math.abs(ringArea(poly[0])) > 0.5);
const geoms = (xs) => xs.map((x) => toGeom(x)).filter((g) => g.length);

export function union(...xs) {
  const gs = geoms(xs);
  return gs.length ? clean(pc.union(...gs)) : [];
}
export function difference(a, ...bs) {
  const ga = toGeom(a), gb = geoms(bs);
  if (!ga.length) return [];
  return gb.length ? clean(pc.difference(ga, ...gb)) : ga;
}
export function intersect(a, ...bs) {
  const gs = [toGeom(a), ...bs.map((b) => toGeom(b))];
  if (gs.some((g) => !g.length)) return [];
  return clean(pc.intersection(...gs));
}
export function xor(...xs) {
  const gs = geoms(xs);
  return gs.length ? clean(pc.xor(...gs)) : [];
}

export function geomArea(geom) {
  let a = 0;
  for (const poly of geom) poly.forEach((ring, i) => (a += (i ? -1 : 1) * Math.abs(ringArea(ring.slice(0, -1)))));
  return a;
}

export function geomCentroid(geom) {
  let A = 0, X = 0, Y = 0;
  for (const poly of geom) {
    poly.forEach((ring, i) => {
      const pts = ring.slice(0, -1);
      const a = (i ? -1 : 1) * Math.abs(ringArea(pts));
      const [cx, cy] = ringCentroid(pts);
      A += a; X += a * cx; Y += a * cy;
    });
  }
  return A ? { x: X / A, y: Y / A, area: A } : { x: 500, y: 500, area: 0 };
}

export const geomBBox = (geom) => bbox(geom.flatMap((poly) => poly[0] ?? []));

// Outline of a polyline stroked at `width` (number or fn(tangent, index) → width).
// Each segment becomes a convex quad on the vertex normals; their union is the stroke.
export function strokeOutline(points, width, { closed = false, cap = "butt" } = {}) {
  const P = points.length;
  if (P < 2) return [];
  const W = typeof width === "function" ? width : () => width;
  const tangent = (i) => {
    const a = points[closed ? (i - 1 + P) % P : Math.max(0, i - 1)];
    const b = points[closed ? (i + 1) % P : Math.min(P - 1, i + 1)];
    const len = dist(a, b) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  const offs = points.map((p, i) => {
    const t = tangent(i), h = W(t, i) / 2;
    return [[p[0] - t[1] * h, p[1] + t[0] * h], [p[0] + t[1] * h, p[1] - t[0] * h]];
  });
  const quads = [];
  const last = closed ? P : P - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % P;
    quads.push([closeRing(convexHull([offs[i][0], offs[j][0], offs[j][1], offs[i][1]]))]);
  }
  if (cap === "round" && !closed) {
    for (const i of [0, P - 1]) quads.push(toGeom(circlePath(points[i][0], points[i][1], W(tangent(i), i) / 2))[0]);
  }
  return clean(pc.union(...quads));
}

function convexHull(pts) {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of s.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Area centroid and bbox of every painted element; strokes count through their outline.
export function measure(elements) {
  const parts = [];
  for (const e of elements) {
    if (e.fill && e.fill !== "none") parts.push(toGeom(e));
    if (e.stroke && e.stroke !== "none" && e.strokeWidth) {
      for (const r of flattenPath(e.d, 1)) parts.push(strokeOutline(r.points, e.strokeWidth, { closed: r.closed }));
    }
  }
  const g = union(...parts.filter((p) => p.length));
  const c = geomCentroid(g), b = geomBBox(g);
  return { centroid: { x: round(c.x), y: round(c.y) }, area: round(c.area), bbox: roundBox(b), geom: g };
}

export function finish(elements, construction = [], extra = {}) {
  const { centroid, bbox: box, area } = measure(elements);
  return { elements, viewBox: "0 0 1000 1000", meta: { centroid, bbox: box, area, overshoot: 0, construction, ...extra } };
}

const round = (v) => Math.round(v * 1000) / 1000;
const roundBox = (b) => ({ minX: round(b.minX), minY: round(b.minY), maxX: round(b.maxX), maxY: round(b.maxY), width: round(b.width), height: round(b.height) });

// Primitives for the generator, sized by their circumscribing radius r around (cx, cy).
export function primitive(kind, cx, cy, r) {
  switch (kind) {
    case "circle": return circlePath(cx, cy, r);
    case "square": return pathFromPoints([[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]);
    case "triangle": return pathFromPoints(regularPolygon(cx, cy + r / 4, r * 1.155, 3));
    case "ring": return circlePath(cx, cy, r) + circlePath(cx, cy, r / PHI, { reverse: true });
    case "half": return `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`;
    default: throw new Error(`boolean: unknown primitive "${kind}"`);
  }
}

const KINDS = ["circle", "square", "triangle", "ring", "half"];

export const name = "boolean";
export const description = "Two primitives on a unit grid combined by one boolean operation: a bite, a cut, a lens. One idea, exact radii.";
export const params = {
  a: { default: "square", enum: KINDS, doc: "first primitive" },
  b: { default: "circle", enum: KINDS, doc: "second primitive" },
  op: { default: "difference", enum: ["union", "difference", "intersect", "xor"], doc: "a op b" },
  size: { default: 300, min: 100, max: 450, doc: "half-size (circumradius) of a, in viewBox units" },
  scaleB: { default: 0.5, min: 0.1, max: 2, doc: "b size as a fraction of a, snapped to 1/8 steps" },
  dx: { default: 1, min: -2, max: 2, doc: "b centre offset in units of a's half-size, snapped to 1/4 steps" },
  dy: { default: -1, min: -2, max: 2, doc: "b centre offset in units of a's half-size, snapped to 1/4 steps" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const q = (v, s) => Math.round(v / s) * s;
  const r = p.size, rb = r * q(p.scaleB, 0.125);
  const bx = 500 + r * q(p.dx, 0.25), by = 500 + r * q(p.dy, 0.25);
  const A = primitive(p.a, 500, 500, r), B = primitive(p.b, bx, by, rb);
  const g = { union, difference, intersect, xor }[p.op](A, B);
  const construction = [
    { type: "circle", cx: 500, cy: 500, r },
    { type: "circle", cx: bx, cy: by, r: rb },
    { type: "line", x1: 500, y1: 500, x2: bx, y2: by },
  ];
  return finish([{ d: fromGeom(g), fill: p.fill, fillRule: "evenodd" }], construction);
}
