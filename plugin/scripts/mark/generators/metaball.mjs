// Metaballs: F(p) = Σ rᵢ² / |p − cᵢ|² (or an SDF smooth-min), iso-contoured with
// marching squares on a 256² field and smoothed with Catmull-Rom.
import { rng, smoothClosedPath } from "../../lib/svg.mjs";
import { resampleClosed, polylineLength, ringArea, TAU } from "../geom.mjs";
import { finish } from "./boolean.mjs";

export const fieldValue = (balls, x, y) => {
  let f = 0;
  for (const b of balls) f += (b.r * b.r) / ((x - b.x) ** 2 + (y - b.y) ** 2 + 1e-9);
  return f;
};

// Polynomial smooth minimum (Quilez); k is the blend radius in units.
export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

// SDF form mapped so the iso level is 1 like the field form: value = 1 − d / 1000.
const sdfValue = (balls, x, y, k) => {
  let d = Infinity;
  for (const b of balls) d = d === Infinity ? Math.hypot(x - b.x, y - b.y) - b.r : smin(d, Math.hypot(x - b.x, y - b.y) - b.r, k);
  return 1 - d / 1000;
};

// Marching squares over [0, size]² with `res` cells per side; returns closed loops.
export function marchingSquares(fn, { res = 256, size = 1000, level = 1 } = {}) {
  const step = size / res, N = res + 1;
  const v = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const edge = i === 0 || j === 0 || i === res || j === res;
    v[j * N + i] = edge ? -Infinity : fn(i * step, j * step) - level;
  }
  const at = (i, j) => v[j * N + i];
  const key = (i, j, horiz) => `${i},${j},${horiz ? 1 : 0}`;
  const pt = (i, j, horiz) => {
    if (horiz) { const a = at(i, j), b = at(i + 1, j); const t = a / (a - b); return [(i + t) * step, j * step]; }
    const a = at(i, j), b = at(i, j + 1); const t = a / (a - b); return [i * step, (j + t) * step];
  };
  const next = new Map(), pos = new Map();
  const seg = (a, b) => { next.set(a.k, b.k); pos.set(a.k, a.p); pos.set(b.k, b.p); };
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const tl = at(i, j) > 0, tr = at(i + 1, j) > 0, br = at(i + 1, j + 1) > 0, bl = at(i, j + 1) > 0;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = { k: key(i, j, true), p: null }, R = { k: key(i + 1, j, false) }, B = { k: key(i, j + 1, true) }, L = { k: key(i, j, false) };
    T.p = pt(i, j, true); R.p = pt(i + 1, j, false); B.p = pt(i, j + 1, true); L.p = pt(i, j, false);
    // Segments oriented so the inside (value > level) is on the right: clockwise outer loops on screen.
    const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
    switch (c) {
      case 1: seg(B, L); break; case 2: seg(R, B); break; case 3: seg(R, L); break; case 4: seg(T, R); break;
      case 5: if (centre) { seg(T, L); seg(B, R); } else { seg(T, R); seg(B, L); } break;
      case 6: seg(T, B); break; case 7: seg(T, L); break; case 8: seg(L, T); break; case 9: seg(B, T); break;
      case 10: if (centre) { seg(L, B); seg(R, T); } else { seg(L, T); seg(R, B); } break;
      case 11: seg(R, T); break; case 12: seg(L, R); break; case 13: seg(B, R); break; case 14: seg(L, B); break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (k && !seen.has(k)) { seen.add(k); loop.push(pos.get(k)); k = next.get(k); }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function arrange(p, rand) {
  const n = p.count, R = p.radius, S = p.spread;
  const jitter = (v) => v * (1 + (rand() - 0.5) * 2 * p.jitter);
  const balls = [];
  if (p.arrangement === "line") {
    for (let i = 0; i < n; i++) balls.push({ x: 500 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * S), y: 500, r: jitter(R) });
  } else if (p.arrangement === "random") {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * S;
      balls.push({ x: 500 + d * Math.cos(a), y: 500 + d * Math.sin(a), r: jitter(R) });
    }
  } else {
    const off = p.arrangement === "ring" ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + off + (i / n) * TAU;
      balls.push({ x: 500 + S * Math.cos(a), y: 500 + S * Math.sin(a), r: jitter(R) });
    }
    if (p.arrangement === "orbit") balls.push({ x: 500, y: 500, r: R * p.core });
  }
  return balls;
}

export const name = "metaball";
export const description = "Soft unions of circles (metaballs or SDF smooth-min) contoured into one smooth outline: organic but built from a stated radius set.";
export const params = {
  arrangement: { default: "ring", enum: ["ring", "orbit", "line", "random"], doc: "ball layout (ring of n, ring around a core, row, seeded scatter)" },
  count: { default: 3, min: 1, max: 9, doc: "number of balls" },
  radius: { default: 150, min: 40, max: 400, doc: "ball radius" },
  spread: { default: 190, min: 0, max: 400, doc: "ring radius / row half-length / scatter radius" },
  core: { default: 0.8, min: 0.2, max: 2, doc: "orbit: core radius as a fraction of ball radius" },
  jitter: { default: 0, min: 0, max: 0.5, doc: "seeded radius variation (0 keeps one radius)" },
  mode: { default: "smin", enum: ["field", "smin"], doc: "field = classic Σr²/d²; smin = SDF smooth-min, keeps the radii exact" },
  blend: { default: 120, min: 1, max: 400, doc: "smin blend radius k" },
  threshold: { default: 1, min: 0.3, max: 3, doc: "field iso level" },
  resolution: { default: 256, min: 64, max: 512, doc: "marching-squares cells per side" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p, seed = 1) {
  const balls = arrange(p, rng(seed));
  const fn = p.mode === "field" ? (x, y) => fieldValue(balls, x, y) : (x, y) => sdfValue(balls, x, y, p.blend);
  const level = p.mode === "field" ? p.threshold : 1;
  const loops = marchingSquares(fn, { res: p.resolution, level }).filter((l) => Math.abs(ringArea(l)) > 50);
  const d = loops.map((l) => smoothClosedPath(resampleClosed(l, Math.max(24, Math.round(polylineLength(l, true) / 12))))).join("");
  const construction = balls.map((b) => ({ type: "circle", cx: b.x, cy: b.y, r: b.r }));
  return finish([{ d, fill: p.fill, fillRule: "evenodd" }], construction, { balls: balls.length, loops: loops.length });
}
