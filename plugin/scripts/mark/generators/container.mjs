// Containers: Figma-style continuous-curvature rounded rectangle (radius R,
// smoothing ξ) and the Lamé superellipse |x/a|^n + |y/b|^n = 1.
import { n, smoothClosedPath } from "../../lib/svg.mjs";
import { resampleClosed, TAU, clamp } from "../geom.mjs";
import { finish, difference, fromGeom } from "./boolean.mjs";

const rad = (deg) => (deg * Math.PI) / 180;

// Corner parameters from Figma's "Desperately seeking squircles" (figure 11–12):
// p = (1 + ξ)·R is how far the smoothed corner reaches along each edge.
export function cornerParams(R, xi, budget) {
  let p = (1 + xi) * R;
  if (p > budget) {
    xi = clamp(budget / R - 1, 0, xi);
    p = Math.min(p, budget);
  }
  const arcMeasure = 90 * (1 - xi);
  const arc = Math.sin(rad(arcMeasure / 2)) * R * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = R * Math.tan(rad(alpha / 2));
  const beta = 45 * xi;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  return { a: 2 * b, b, c, d, p, arc, R, xi };
}

export function smoothRectPath(x, y, w, h, R, xi = 0.6) {
  R = Math.min(R, w / 2, h / 2);
  if (R <= 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  const { a, b, c, d, p, arc } = cornerParams(R, xi, Math.min(w, h) / 2);
  const f = n;
  return [
    `M${f(x + w - p)} ${f(y)}`,
    `c${f(a)} 0 ${f(a + b)} 0 ${f(a + b + c)} ${f(d)}`,
    `a${f(R)} ${f(R)} 0 0 1 ${f(arc)} ${f(arc)}`,
    `c${f(d)} ${f(c)} ${f(d)} ${f(b + c)} ${f(d)} ${f(a + b + c)}`,
    `L${f(x + w)} ${f(y + h - p)}`,
    `c0 ${f(a)} 0 ${f(a + b)} ${f(-d)} ${f(a + b + c)}`,
    `a${f(R)} ${f(R)} 0 0 1 ${f(-arc)} ${f(arc)}`,
    `c${f(-c)} ${f(d)} ${f(-(b + c))} ${f(d)} ${f(-(a + b + c))} ${f(d)}`,
    `L${f(x + p)} ${f(y + h)}`,
    `c${f(-a)} 0 ${f(-(a + b))} 0 ${f(-(a + b + c))} ${f(-d)}`,
    `a${f(R)} ${f(R)} 0 0 1 ${f(-arc)} ${f(-arc)}`,
    `c${f(-d)} ${f(-c)} ${f(-d)} ${f(-(b + c))} ${f(-d)} ${f(-(a + b + c))}`,
    `L${f(x)} ${f(y + p)}`,
    `c0 ${f(-a)} 0 ${f(-(a + b))} ${f(d)} ${f(-(a + b + c))}`,
    `a${f(R)} ${f(R)} 0 0 1 ${f(arc)} ${f(-arc)}`,
    `c${f(c)} ${f(-d)} ${f(b + c)} ${f(-d)} ${f(a + b + c)} ${f(-d)}`,
    "Z",
  ].join("");
}

export function lamePoints(cx, cy, a, b, exponent, count = 256) {
  const e = 2 / exponent;
  const dense = [];
  for (let i = 0; i < 2048; i++) {
    const t = (i / 2048) * TAU, c = Math.cos(t), s = Math.sin(t);
    dense.push([cx + a * Math.sign(c) * Math.abs(c) ** e, cy + b * Math.sign(s) * Math.abs(s) ** e]);
  }
  return resampleClosed(dense, count);
}

export const lamePath = (cx, cy, a, b, exponent) => smoothClosedPath(lamePoints(cx, cy, a, b, exponent));

export const name = "container";
export const description = "App-icon and badge containers: Figma smooth corner (R, ξ) or Lamé superellipse (n). Solid or as a ring.";
export const params = {
  shape: { default: "smooth", enum: ["smooth", "lame"], doc: "smooth = continuous-curvature rounded rect; lame = superellipse" },
  size: { default: 760, min: 100, max: 1000, doc: "width in viewBox units" },
  aspect: { default: 1, min: 0.25, max: 4, doc: "height / width" },
  radius: { default: 200, min: 0, max: 500, doc: "corner radius R (smooth)" },
  smoothing: { default: 0.6, min: 0, max: 1, doc: "corner smoothing ξ (smooth); 0.6 = iOS" },
  exponent: { default: 5, min: 2, max: 12, doc: "Lamé exponent n; 2 ellipse, 4 squircle, ≈5 iOS-like" },
  ring: { default: 0, min: 0, max: 300, doc: "ring thickness; 0 = solid" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const w = p.size, h = p.size * p.aspect, x = 500 - w / 2, y = 500 - h / 2;
  const outer = (inset) =>
    p.shape === "lame"
      ? lamePath(500, 500, w / 2 - inset, h / 2 - inset, p.exponent)
      : smoothRectPath(x + inset, y + inset, w - 2 * inset, h - 2 * inset, Math.max(0, p.radius - inset), p.smoothing);
  const d = p.ring > 0 ? fromGeom(difference(outer(0), outer(p.ring))) : outer(0);
  const construction = [
    { type: "line", x1: x, y1: y, x2: x + w, y2: y }, { type: "line", x1: x + w, y1: y, x2: x + w, y2: y + h },
    { type: "line", x1: x + w, y1: y + h, x2: x, y2: y + h }, { type: "line", x1: x, y1: y + h, x2: x, y2: y },
  ];
  if (p.shape === "smooth") {
    const R = Math.min(p.radius, w / 2, h / 2);
    for (const [cx, cy] of [[x + R, y + R], [x + w - R, y + R], [x + w - R, y + h - R], [x + R, y + h - R]]) construction.push({ type: "circle", cx, cy, r: R });
  } else {
    construction.push({ type: "circle", cx: 500, cy: 500, r: Math.min(w, h) / 2 });
  }
  return finish([{ d, fill: p.fill, fillRule: "evenodd" }], construction);
}
