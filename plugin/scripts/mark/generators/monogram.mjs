// Stroke-skeleton capitals for monograms. Each letter is built from stems, bars,
// diagonals (parallelograms with horizontal cuts) and elliptic bowls stroked with a
// width that thins toward horizontal tangents. Rounds overshoot cap height and baseline.
import { finish, union, difference, intersect, strokeOutline, fromGeom } from "./boolean.mjs";
import { pathFromPoints } from "../../lib/svg.mjs";
import { circlePath } from "../geom.mjs";
import { smoothRectPath } from "./container.mjs";

// Letter widths as a fraction of cap height (outer extents, before tracking).
const WIDTH = {
  A: 0.84, B: 0.62, C: 0.84, D: 0.74, E: 0.56, F: 0.53, G: 0.86, H: 0.7, I: 0, J: 0.54, K: 0.66, L: 0.52, M: 0.86,
  N: 0.72, O: 0.98, P: 0.62, Q: 0.98, R: 0.66, S: 0.66, T: 0.64, U: 0.7, V: 0.8, W: 1.18, X: 0.76, Y: 0.76, Z: 0.62,
};
export const LETTERS = Object.keys(WIDTH);
// Vertical terminal cuts: angle on the bowl (from 3 o'clock) where the cut falls.
const APERTURE = { C: 46, G: 34, S: 58 };

// Context: H cap height, w stem, wh horizontal weight, o overshoot (units), W letter width.
function kit({ H, w, wh, o }) {
  const rect = (x0, y0, x1, y1) => ({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const stem = (x, y0 = 0, y1 = H) => rect(x, y0, x + w, y1);
  const bar = (x0, x1, yc) => rect(x0, yc - wh / 2, x1, yc + wh / 2);
  // Diagonal from (xb, yb) to (xt, yt) cut horizontally at both ends; xb/xt are centreline x.
  const diag = (xb, yb, xt, yt) => {
    let hw = w / 2;
    for (let i = 0; i < 6; i++) {
      const sin = Math.abs(yt - yb) / Math.hypot(xt - xb, yt - yb);
      const perp = wh + (w - wh) * sin;
      hw = perp / (2 * sin);
    }
    return { poly: [[xb - hw, yb], [xb + hw, yb], [xt + hw, yt], [xt - hw, yt]], hw };
  };
  // Horizontal half-width of a diagonal running full height between two x positions.
  const dhw = (dx, dy = H) => diag(0, 0, dx, dy).hw;
  const ell = (cx, cy, rx, ry, a0, a1, steps = 96) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
  const stroke = (pts, closed = false) => ({ stroke: pts, closed });
  const ring = (W) => stroke(ell(W / 2, H / 2, W / 2 - w / 2, H / 2 - wh / 2 + o, 0, 360, 192).slice(0, -1), true);
  // Bowl hanging off a stem: top bar → half ellipse → bottom bar, between yb (bottom) and yt (top) outer edges.
  const bowl = (W, yb, yt, x0 = w / 2) => {
    const ry = (yt - yb - wh) / 2, cy = (yt + yb) / 2;
    const rx = Math.min(ry * 1.05, W - w / 2 - x0 - w / 2);
    const xb = W - w / 2 - rx;
    return { part: stroke([[x0, yt - wh / 2], ...ell(xb, cy, rx, ry, 90, -90, 96), [x0, yb + wh / 2]]), xb, cy, rx, ry };
  };
  return { rect, stem, bar, diag, dhw, ell, stroke, ring, bowl };
}

// Each builder returns { parts, cuts?, clip? } in letter space (baseline y = 0, y up).
const BUILD = {
  I: (k) => ({ parts: [k.stem(0)] }),
  L: (k, { W, wh }) => ({ parts: [k.stem(0), k.bar(0, W, wh / 2)] }),
  T: (k, { W, H, w, wh }) => ({ parts: [k.bar(0, W, H - wh / 2), k.stem(W / 2 - w / 2)] }),
  E: (k, { W, H, wh }) => ({ parts: [k.stem(0), k.bar(0, W, H - wh / 2), k.bar(0, W * 0.9, H * 0.5), k.bar(0, W, wh / 2)] }),
  F: (k, { W, H, wh }) => ({ parts: [k.stem(0), k.bar(0, W, H - wh / 2), k.bar(0, W * 0.9, H * 0.48)] }),
  H: (k, { W, H, w }) => ({ parts: [k.stem(0), k.stem(W - w), k.bar(0, W, H * 0.52)] }),
  N: (k, { W, H, w }) => {
    const hw = k.dhw(W - w, H);
    return { parts: [k.stem(0), k.stem(W - w), k.diag(W - hw, 0, hw, H)] };
  },
  M: (k, { W, H, w }) => {
    const hw = k.dhw(W / 2, H);
    return { parts: [k.stem(0), k.stem(W - w), k.diag(W / 2, 0, hw, H), k.diag(W / 2, 0, W - hw, H)] };
  },
  V: (k, { W, H }) => {
    const hw = k.dhw(W / 2, H);
    return { parts: [k.diag(W / 2, 0, hw, H), k.diag(W / 2, 0, W - hw, H)] };
  },
  W: (k, { W, H }) => {
    const hw = k.dhw(W / 4, H);
    return { parts: [k.diag(W / 4, 0, hw, H), k.diag(W / 4, 0, W / 2, H), k.diag(3 * W / 4, 0, W / 2, H), k.diag(3 * W / 4, 0, W - hw, H)] };
  },
  A: (k, { W, H, wh }) => {
    const hw = k.dhw(W / 2, H);
    const L = k.diag(hw, 0, W / 2, H), R = k.diag(W - hw, 0, W / 2, H);
    return { parts: [L, R, k.bar(hw, W - hw, H * 0.28 + wh / 2)], clip: [[0, 0], [W, 0], [W / 2 + hw, H], [W / 2 - hw, H]] };
  },
  X: (k, { W, H }) => {
    const hw = k.dhw(W, H);
    return { parts: [k.diag(hw, 0, W - hw, H), k.diag(W - hw, 0, hw, H)] };
  },
  Y: (k, { W, H, w }) => {
    const yj = H * 0.44, hw = k.dhw(W / 2, H - yj);
    return { parts: [k.diag(W / 2, yj, hw, H), k.diag(W / 2, yj, W - hw, H), k.stem(W / 2 - w / 2, 0, yj + 1)] };
  },
  K: (k, { W, H, w }) => {
    const yj = H * 0.36;
    const ha = k.dhw(W - w, H - yj), hl = k.dhw(W - w, yj * 1.5);
    return { parts: [k.stem(0), k.diag(w - ha, yj, W - ha, H), k.diag(W - hl, 0, w - hl * 0.6, yj * 1.5)], clip: [[0, 0], [W, 0], [W, H], [0, H]] };
  },
  Z: (k, { W, H, wh }) => {
    const hw = k.dhw(W, H - 2 * wh);
    return { parts: [k.bar(0, W, H - wh / 2), k.bar(0, W, wh / 2), k.diag(hw, wh / 2, W - hw, H - wh / 2)] };
  },
  O: (k, { W }) => ({ parts: [k.ring(W)] }),
  Q: (k, { W, H, w, o }) => ({
    parts: [k.ring(W), k.stroke([[W * 0.6, H * 0.3], [W * 1.0, -o - H * 0.04]])],
  }),
  C: (k, ctx, Wo) => ({ parts: [k.ring(Wo)], cuts: [[[ctx.W, -ctx.H], [Wo * 2, -ctx.H], [Wo * 2, 2 * ctx.H], [ctx.W, 2 * ctx.H]]] }),
  G: (k, { W, H, w, wh, o }, Wo) => {
    const yc = H * 0.44;
    return {
      parts: [k.ring(Wo), k.bar(Wo / 2, W, yc), k.rect(W - w, H * 0.1, W, yc + wh / 2)],
      cuts: [[[W, -H], [Wo * 2, -H], [Wo * 2, 2 * H], [W, 2 * H]], [[W - w, yc + wh / 2], [W, yc + wh / 2], [W, H * 0.62], [W - w, H * 0.62]]],
      clipEllipse: { cx: Wo / 2, cy: H / 2, rx: Wo / 2, ry: H / 2 + o },
    };
  },
  D: (k, { W, H }) => ({ parts: [k.stem(0), k.bowl(W, 0, H).part] }),
  P: (k, { W, H, wh }) => ({ parts: [k.stem(0), k.bowl(W, H * 0.4, H).part] }),
  R: (k, { W, H, wh, w }) => {
    const b = k.bowl(W * 0.94, H * 0.42, H);
    const hw = k.dhw(W - b.xb, H * 0.42);
    return { parts: [k.stem(0), b.part, k.diag(W - hw, 0, b.xb - hw * 0.2, H * 0.42 + wh / 2)], clip: [[0, 0], [W, 0], [W, H], [0, H]] };
  },
  B: (k, { W, H, wh }) => {
    const ym = H * 0.54;
    return { parts: [k.stem(0), k.bowl(W * 0.9, ym - wh / 2, H).part, k.bowl(W, 0, ym + wh / 2).part] };
  },
  U: (k, { W, H, w, wh, o }) => {
    const rx = W / 2 - w / 2, ry = Math.min(rx * 1.05, H * 0.5), cy = ry + wh / 2 - o;
    return { parts: [k.stroke([[w / 2, H], ...k.ell(W / 2, cy, rx, ry, 180, 360, 96), [W - w / 2, H]])] };
  },
  J: (k, { W, H, w, wh, o }) => {
    const rx = W / 2 - w / 2, ry = Math.min(rx * 1.05, H * 0.5), cy = ry + wh / 2 - o;
    return { parts: [k.stroke([[W - w / 2, H], ...k.ell(W / 2, cy, rx, ry, 360, 180, 96)])] };
  },
  S: (k, { W, H, w, wh, o }) => {
    const ratio = 0.9;
    const r2y = (H + 2 * o - wh) / 2 / (1 + ratio), r1y = ratio * r2y;
    const r2x = W / 2 - w / 2, r1x = r2x * 0.94;
    const cy1 = H + o - wh / 2 - r1y, cy2 = -o + wh / 2 + r2y, cx = W / 2;
    const top = k.ell(cx, cy1, r1x, r1y, 0, 270, 120), bottom = k.ell(cx, cy2, r2x, r2y, 90, -180, 120).slice(1);
    const c = Math.cos((APERTURE.S * Math.PI) / 180);
    const spine = cy1 - r1y, xt = cx + r1x * c, xb = cx - r2x * c, yt = spine + r1y * 0.45, yb = spine - r2y * 0.45;
    return {
      parts: [k.stroke([...top, ...bottom])],
      cuts: [[[xt, yt], [W * 2, yt], [W * 2, H * 2], [xt, H * 2]], [[-W, -H], [xb, -H], [xb, yb], [-W, yb]]],
    };
  },
};

function letterWidth(L, { H, w }) {
  if (L === "I") return w;
  if (L === "C" || L === "G") {
    const Wo = WIDTH.O * H;
    return Wo / 2 + (Wo / 2 - w / 2) * Math.cos((APERTURE[L] * Math.PI) / 180) + w * 0.15;
  }
  return WIDTH[L] * H;
}

// One letter → polyclip geometry in canvas space. `at(x, y)` maps letter space → canvas.
export function letterGeom(ch, opts, at) {
  const L = ch.toUpperCase();
  if (!BUILD[L]) throw new Error(`monogram: no skeleton for "${ch}" (have ${LETTERS.join("")})`);
  const { H, w, thinning } = opts;
  const ctx = { H, w, wh: w * thinning, o: opts.overshoot * H };
  const Wo = WIDTH.O * H;
  ctx.W = letterWidth(L, ctx);
  const k = kit(ctx);
  const spec = BUILD[L](k, ctx, Wo);
  const map = (pts) => pts.map(([x, y]) => at(x, y));
  const widthAt = ([tx, ty]) => ctx.wh + (ctx.w - ctx.wh) * Math.abs(ty);
  const parts = spec.parts.map((p) =>
    p.poly ? pathFromPoints(map(p.poly)) : strokeOutline(map(p.stroke), (t) => widthAt(t) * opts.scale, { closed: p.closed }),
  );
  let g = union(...parts);
  if (spec.cuts) g = difference(g, ...spec.cuts.map((c) => pathFromPoints(map(c))));
  if (spec.clip) g = intersect(g, pathFromPoints(map(spec.clip)));
  if (spec.clipEllipse) {
    const e = spec.clipEllipse;
    g = intersect(g, pathFromPoints(map(k.ell(e.cx, e.cy, e.rx, e.ry, 0, 360, 256).slice(0, -1))));
  }
  return { geom: g, width: ctx.W };
}

export const name = "monogram";
export const description = "One to three capitals from a geometric stroke skeleton: one weight, thinned horizontals, overshooting rounds. Optional container with the letters knocked out.";
export const params = {
  letters: { default: "S", doc: "1–3 capitals A–Z" },
  capHeight: { default: 560, min: 200, max: 800, doc: "cap height in viewBox units before fitting" },
  weight: { default: 0.17, min: 0.06, max: 0.3, doc: "stem weight as a fraction of cap height (≥ 0.112 keeps 1 px at 16 px for a 560 cap)" },
  thinning: { default: 0.88, min: 0.6, max: 1, doc: "horizontal / vertical stroke ratio" },
  overshoot: { default: 0.02, min: 0, max: 0.04, doc: "round overshoot past cap height and baseline, fraction of cap height" },
  tracking: { default: 0.6, min: -1, max: 3, doc: "gap between letters in stem weights; negative overlaps into a ligature" },
  container: { default: "none", enum: ["none", "circle", "squircle", "square"], doc: "shape behind the letters" },
  knockout: { default: true, doc: "with a container: letters cut out of it (one fill, negative-space counter)" },
  ringWeight: { default: 1, min: 0.5, max: 2, doc: "without knockout: container ring thickness in stem weights" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const letters = String(p.letters).replace(/\s+/g, "").slice(0, 3);
  if (!letters) throw new Error("monogram: letters is empty");
  const H = p.capHeight, w = p.weight * H;
  const opts = { H, w, thinning: p.thinning, overshoot: p.overshoot, scale: 1 };
  for (const ch of letters) if (!BUILD[ch.toUpperCase()]) throw new Error(`monogram: no skeleton for "${ch}" (have ${LETTERS.join("")})`);
  const widths = [...letters].map((ch) => letterWidth(ch.toUpperCase(), { H, w }));
  const gap = p.tracking * w;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
  // Fit: free-standing letters fill 84% of the canvas; inside a container they sit in its safe zone.
  const box = p.container === "none" ? 840 : p.container === "circle" ? 2 * 400 * 0.68 : 800 * 0.66;
  const s = Math.min(1, box / total, box / (H * (1 + 2 * p.overshoot)));
  opts.scale = s;
  const x0 = 500 - (total * s) / 2, base = 500 + (H * s) / 2;
  let x = 0;
  const geoms = [...letters].map((ch, i) => {
    const off = x;
    x += widths[i] + gap;
    return letterGeom(ch, opts, (lx, ly) => [x0 + (off + lx) * s, base - ly * s]).geom;
  });
  let g = union(...geoms);
  const construction = [
    { type: "line", x1: 0, y1: base, x2: 1000, y2: base },
    { type: "line", x1: 0, y1: base - H * s, x2: 1000, y2: base - H * s },
    { type: "line", x1: 0, y1: base + p.overshoot * H * s, x2: 1000, y2: base + p.overshoot * H * s },
    { type: "line", x1: 0, y1: base - H * s * (1 + p.overshoot), x2: 1000, y2: base - H * s * (1 + p.overshoot) },
    { type: "line", x1: 0, y1: base - (H * s) / 2, x2: 1000, y2: base - (H * s) / 2 },
  ];
  x = 0;
  widths.forEach((wd, i) => {
    for (const lx of [x, x + wd]) construction.push({ type: "line", x1: x0 + lx * s, y1: 0, x2: x0 + lx * s, y2: 1000 });
    x += wd + gap;
  });
  const elements = [];
  if (p.container !== "none") {
    const shape = p.container === "circle" ? circlePath(500, 500, 400) : smoothRectPath(100, 100, 800, 800, p.container === "squircle" ? 220 : 0, 0.6);
    construction.push(p.container === "circle" ? { type: "circle", cx: 500, cy: 500, r: 400 } : { type: "line", x1: 100, y1: 100, x2: 900, y2: 100 });
    if (p.knockout) g = difference(shape, g);
    else {
      const t = p.ringWeight * w * s;
      const inner = p.container === "circle" ? circlePath(500, 500, 400 - t) : smoothRectPath(100 + t, 100 + t, 800 - 2 * t, 800 - 2 * t, p.container === "squircle" ? Math.max(0, 220 - t) : 0, 0.6);
      g = union(g, difference(shape, inner));
    }
  }
  elements.push({ d: fromGeom(g), fill: p.fill, fillRule: "evenodd" });
  return finish(elements, construction, { overshoot: p.overshoot, stem: w * s, letters, letterBox: { x0, base, capHeight: H * s, width: total * s } });
}
