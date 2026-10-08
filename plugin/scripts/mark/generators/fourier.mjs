// Fourier smoothing: a closed path or polyline resampled by arc length, transformed
// with a DFT and rebuilt from the harmonics |k| ≤ N. Coefficients double as epicycles.
import { smoothClosedPath, pathFromPoints } from "../../lib/svg.mjs";
import { flattenPath, resampleClosed, regularPolygon, TAU } from "../geom.mjs";
import { finish } from "./boolean.mjs";

export function dft(points) {
  const M = points.length, out = [];
  for (let k = 0; k < M; k++) {
    let re = 0, im = 0;
    for (let m = 0; m < M; m++) {
      const a = (-TAU * k * m) / M, [x, y] = points[m];
      re += x * Math.cos(a) - y * Math.sin(a);
      im += x * Math.sin(a) + y * Math.cos(a);
    }
    const freq = k <= M / 2 ? k : k - M;
    out.push({ freq, re: re / M, im: im / M });
  }
  return out;
}

// Rebuild `count` points from the coefficients with |freq| ≤ N (N ≥ M/2 keeps all).
export function reconstruct(coeffs, N, count) {
  const kept = coeffs.filter((c) => Math.abs(c.freq) <= N);
  return Array.from({ length: count }, (_, m) => {
    const t = m / count;
    let x = 0, y = 0;
    for (const c of kept) {
      const a = TAU * c.freq * t, ca = Math.cos(a), sa = Math.sin(a);
      x += c.re * ca - c.im * sa;
      y += c.re * sa + c.im * ca;
    }
    return [x, y];
  });
}

export function samplesOf({ d, points, shape }, M) {
  let ring;
  if (points?.length) ring = points;
  else if (d) ring = flattenPath(d, 0.25)[0]?.points;
  else ring = regularPolygon(500, 500, 400, { triangle: 3, square: 4, pentagon: 5 }[shape] ?? 3);
  if (!ring || ring.length < 3) throw new Error("fourier: input needs a closed path or ≥ 3 points");
  return resampleClosed(ring, M);
}

export const name = "fourier";
export const description = "Any closed outline smoothed by keeping its first N Fourier harmonics: polygons become soft, even-curvature forms; the epicycles animate.";
export const params = {
  d: { default: null, doc: "input path data (first subpath is used)" },
  points: { default: null, doc: "input polyline [[x, y], …] instead of d" },
  shape: { default: "triangle", enum: ["triangle", "square", "pentagon"], doc: "built-in input when neither d nor points is given" },
  harmonics: { default: 3, min: 1, max: 512, doc: "N: harmonics kept on each side of 0; ≥ samples/2 reproduces the input" },
  samples: { default: 256, min: 16, max: 1024, doc: "arc-length samples M of the input" },
  size: { default: 0, min: 0, max: 480, doc: "fit the result to this radius around the centre; 0 keeps input coordinates" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const M = Math.round(p.samples);
  const input = samplesOf(p, M);
  const coeffs = dft(input);
  let out = reconstruct(coeffs, Math.round(p.harmonics), M);
  if (p.size > 0) {
    const cx = coeffs[0].re, cy = coeffs[0].im;
    const ext = Math.max(...out.map(([x, y]) => Math.hypot(x - cx, y - cy))) || 1;
    out = out.map(([x, y]) => [500 + ((x - cx) / ext) * p.size, 500 + ((y - cy) / ext) * p.size]);
  }
  const d = Math.round(p.harmonics) >= M / 2 ? pathFromPoints(out) : smoothClosedPath(out);
  const epicycles = coeffs
    .filter((c) => c.freq !== 0 && Math.abs(c.freq) <= p.harmonics)
    .map((c) => ({ freq: c.freq, amp: Math.hypot(c.re, c.im), phase: Math.atan2(c.im, c.re) }))
    .sort((a, b) => b.amp - a.amp);
  const construction = epicycles.slice(0, 3).map((e) => ({ type: "circle", cx: coeffs[0].re, cy: coeffs[0].im, r: e.amp }));
  return finish([{ d, fill: p.fill }], construction, { harmonics: Math.round(p.harmonics), epicycles: epicycles.slice(0, 32), samples: out.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) });
}
