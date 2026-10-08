// Hypotrochoids, epitrochoids and roses sampled over their exact period, drawn as
// one constant-weight band or filled even-odd.
import { finish, strokeOutline, fromGeom, toGeom } from "./boolean.mjs";
import { gcd, resampleClosed, polylineLength } from "../geom.mjs";
import { pathFromPoints } from "../../lib/svg.mjs";

// Exact period of each curve; integer R, r and p/q make it closed.
export function trochoidPeriod({ curve, R, r, p: pp, q }) {
  if (curve === "rose") {
    const g = gcd(pp, q), P = pp / g, Q = q / g;
    return (P % 2 && Q % 2 ? 1 : 2) * Math.PI * Q;
  }
  return (2 * Math.PI * r) / gcd(R, r);
}

// Points over [0, T] inclusive (first ≈ last), unscaled.
export function trochoidPoints(params, steps) {
  const { curve, R, r, d, p: pp, q } = params;
  const T = trochoidPeriod(params);
  const n = steps ?? Math.min(6000, Math.max(720, Math.round((T / (2 * Math.PI)) * 720)));
  const f =
    curve === "hypotrochoid" ? (t) => [(R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)]
    : curve === "epitrochoid" ? (t) => [(R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t), (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t)]
    : (t) => { const k = pp / q, rr = Math.cos(k * t); return [rr * Math.cos(t), rr * Math.sin(t)]; };
  return Array.from({ length: n + 1 }, (_, i) => f((i / n) * T - Math.PI / 2));
}

export const name = "trochoid";
export const description = "Spirograph family (hypo/epitrochoid) and rhodonea roses, closed over the exact period, as a single-weight band or an even-odd fill.";
export const params = {
  curve: { default: "rose", enum: ["hypotrochoid", "epitrochoid", "rose"], doc: "curve family" },
  R: { default: 3, min: 1, max: 24, doc: "fixed circle radius (integer)" },
  r: { default: 1, min: 1, max: 24, doc: "rolling circle radius (integer); lobes = R / gcd(R, r)" },
  d: { default: 0.5, min: 0, max: 24, doc: "pen distance from the rolling centre" },
  p: { default: 3, min: 1, max: 12, doc: "rose k = p / q (integer numerator)" },
  q: { default: 1, min: 1, max: 12, doc: "rose k = p / q (integer denominator)" },
  size: { default: 380, min: 100, max: 470, doc: "outer radius after fitting" },
  render: { default: "fill", enum: ["stroke", "fill"], doc: "stroke = band of constant weight; fill = even-odd regions" },
  weight: { default: 72, min: 8, max: 200, doc: "band weight (stroke render)" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const P = { ...p, R: Math.round(p.R), r: Math.round(p.r), p: Math.round(p.p), q: Math.round(p.q) };
  const raw = trochoidPoints(P);
  const ext = Math.max(...raw.map(([x, y]) => Math.hypot(x, y))) || 1;
  const inner = p.render === "stroke" ? p.size - p.weight / 2 : p.size;
  const pts = raw.slice(0, -1).map(([x, y]) => [500 + (x / ext) * inner, 500 + (y / ext) * inner]);
  const even = resampleClosed(pts, Math.min(4000, Math.max(240, Math.round(polylineLength(pts, true) / 6))));
  const geom = p.render === "stroke" ? strokeOutline(even, p.weight, { closed: true }) : toGeom(pathFromPoints(even), "evenodd");
  const construction = [{ type: "circle", cx: 500, cy: 500, r: inner }];
  if (P.curve !== "rose") {
    const k = inner / ext, Rk = P.R * k;
    construction.push({ type: "circle", cx: 500, cy: 500, r: Rk }, { type: "circle", cx: 500, cy: 500 - (P.curve === "hypotrochoid" ? P.R - P.r : P.R + P.r) * k, r: P.r * k });
  }
  return finish([{ d: fromGeom(geom), fill: p.fill, fillRule: "evenodd" }], construction, { period: trochoidPeriod(P), samples: even.length });
}
