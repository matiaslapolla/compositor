// Path geometry for marks: parse/serialize SVG path data, uniform transforms,
// flattening to polygons, and convex-polygon helpers. No dependencies.
import { n, bbox } from "../lib/svg.mjs";

export const PHI = (1 + Math.sqrt(5)) / 2;
export const TAU = Math.PI * 2;

// Subpath: { start:[x,y], segs:[{c:"L",p}|{c:"C",c1,c2,p}|{c:"A",rx,ry,rot,large,sweep,p}], closed }
export function parsePath(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let i = 0, cmd = null, cur = [0, 0], start = [0, 0], sp = null;
  let lastC2 = null, lastQ = null;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    const t = tokens[i];
    if (t.length > 1 && /^[01]/.test(t)) { tokens[i] = t.slice(1); return Number(t[0]); }
    i++;
    return Number(t);
  };
  const ensure = () => { if (!sp) { sp = { start: [...cur], segs: [], closed: false }; subpaths.push(sp); } };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error(`path: number before command in "${String(d).slice(0, 40)}"`);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0;
    let q = null, c2 = null;
    switch (C) {
      case "M": {
        cur = [ox + num(), oy + num()];
        start = [...cur];
        sp = { start: [...cur], segs: [], closed: false };
        subpaths.push(sp);
        cmd = rel ? "l" : "L";
        break;
      }
      case "L": ensure(); cur = [ox + num(), oy + num()]; sp.segs.push({ c: "L", p: cur }); break;
      case "H": ensure(); cur = [(rel ? cur[0] : 0) + num(), cur[1]]; sp.segs.push({ c: "L", p: cur }); break;
      case "V": ensure(); cur = [cur[0], (rel ? cur[1] : 0) + num()]; sp.segs.push({ c: "L", p: cur }); break;
      case "C": {
        ensure();
        const c1 = [ox + num(), oy + num()]; c2 = [ox + num(), oy + num()]; const p = [ox + num(), oy + num()];
        sp.segs.push({ c: "C", c1, c2, p }); cur = p; break;
      }
      case "S": {
        ensure();
        const c1 = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : [...cur];
        c2 = [ox + num(), oy + num()]; const p = [ox + num(), oy + num()];
        sp.segs.push({ c: "C", c1, c2, p }); cur = p; break;
      }
      case "Q": case "T": {
        ensure();
        q = C === "Q" ? [ox + num(), oy + num()] : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : [...cur];
        const p = [ox + num(), oy + num()];
        sp.segs.push({ c: "C", c1: lerp2(cur, q, 2 / 3), c2: lerp2(p, q, 2 / 3), p }); cur = p; break;
      }
      case "A": {
        ensure();
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
        const p = [ox + num(), oy + num()];
        sp.segs.push({ c: "A", rx: Math.abs(rx), ry: Math.abs(ry), rot, large, sweep, p }); cur = p; break;
      }
      case "Z": {
        if (sp) sp.closed = true;
        cur = [...start];
        sp = null;
        break;
      }
      default: throw new Error(`path: unsupported command ${cmd}`);
    }
    lastC2 = c2; lastQ = q;
  }
  return subpaths.filter((s) => s.segs.length);
}

export function serializePath(subpaths) {
  let d = "";
  for (const s of subpaths) {
    d += `M${n(s.start[0])} ${n(s.start[1])}`;
    for (const g of s.segs) {
      if (g.c === "L") d += `L${n(g.p[0])} ${n(g.p[1])}`;
      else if (g.c === "C") d += `C${n(g.c1[0])} ${n(g.c1[1])} ${n(g.c2[0])} ${n(g.c2[1])} ${n(g.p[0])} ${n(g.p[1])}`;
      else d += `A${n(g.rx)} ${n(g.ry)} ${n(g.rot)} ${g.large ? 1 : 0} ${g.sweep ? 1 : 0} ${n(g.p[0])} ${n(g.p[1])}`;
    }
    if (s.closed) d += "Z";
  }
  return d;
}

// Uniform scale about the origin then translate; arcs survive exactly.
export function transformPath(subpaths, { s = 1, tx = 0, ty = 0 } = {}) {
  const T = ([x, y]) => [x * s + tx, y * s + ty];
  return subpaths.map((sp) => ({
    start: T(sp.start),
    closed: sp.closed,
    segs: sp.segs.map((g) =>
      g.c === "L" ? { c: "L", p: T(g.p) } :
      g.c === "C" ? { c: "C", c1: T(g.c1), c2: T(g.c2), p: T(g.p) } :
      { ...g, rx: g.rx * Math.abs(s), ry: g.ry * Math.abs(s), sweep: s < 0 ? 1 - g.sweep : g.sweep, p: T(g.p) }),
  }));
}

export const transformD = (d, t) => serializePath(transformPath(parsePath(d), t));

// Every subpath → polyline within `tol` units of the true curve.
export function flattenPath(input, tol = 0.25) {
  const subpaths = typeof input === "string" ? parsePath(input) : input;
  return subpaths.map((sp) => {
    const pts = [sp.start];
    let cur = sp.start;
    for (const g of sp.segs) {
      if (g.c === "L") pts.push(g.p);
      else if (g.c === "C") flattenCubic(cur, g.c1, g.c2, g.p, tol, pts);
      else for (const [c1, c2, p] of arcToCubics(cur, g)) flattenCubic(pts.at(-1), c1, c2, p, tol, pts);
      cur = g.p;
    }
    if (pts.length > 1 && dist(pts[0], pts.at(-1)) < 1e-9) pts.pop();
    return { points: pts, closed: sp.closed };
  });
}

// Wang's bound: segments needed so a cubic stays within tol of its chords.
function flattenCubic(p0, p1, p2, p3, tol, out) {
  const l = Math.max(
    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
  );
  const steps = Math.max(1, Math.ceil(Math.sqrt((0.75 * l) / tol)));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
}

// SVG endpoint arc → ≤90° cubic pieces (W3C SVG implementation notes F.6.5).
export function arcToCubics(from, { rx, ry, rot, large, sweep, p }) {
  const [x1, y1] = from, [x2, y2] = p;
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[from, p, p]];
  const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= TAU;
  if (sweep && dt < 0) dt += TAU;
  const pieces = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / pieces, k = (4 / 3) * Math.tan(step / 4);
  const E = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const D = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let j = 0; j < pieces; j++) {
    const a = t1 + j * step, b = a + step;
    const pa = j ? E(a) : from, pb = j === pieces - 1 ? p : E(b), da = D(a), db = D(b);
    out.push([[pa[0] + k * da[0], pa[1] + k * da[1]], [pb[0] - k * db[0], pb[1] - k * db[1]], pb]);
  }
  return out;
}

// Signed shoelace area; positive = clockwise on screen (y down).
export function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function ringCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : [bbox(pts).cx, bbox(pts).cy];
}


// Closed polyline resampled to `count` points evenly spaced by arc length.
export function resampleClosed(points, count) {
  const P = points.length;
  const cum = [0];
  for (let i = 0; i < P; i++) cum.push(cum[i] + dist(points[i], points[(i + 1) % P]));
  const total = cum[P];
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push(lerp2(points[j], points[(j + 1) % P], t));
  }
  return out;
}

export function polylineLength(points, closed = false) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += dist(points[i - 1], points[i]);
  return closed && points.length > 1 ? L + dist(points.at(-1), points[0]) : L;
}

// Circle as two exact arcs.
export function circlePath(cx, cy, r, { reverse = false } = {}) {
  const s = reverse ? 0 : 1;
  return `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 ${s} ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 ${s} ${n(cx + r)} ${n(cy)}Z`;
}

export function regularPolygon(cx, cy, r, sides, rotation = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, i) => {
    const a = rotation + (i / sides) * TAU;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

// Convex polygon clipped by the half-plane on the left of a→b when the polygon is clockwise on screen.
function clipHalfPlane(poly, a, b) {
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push(lerp2(p, q, t));
    }
  }
  return out;
}

export const clockwise = (poly) => (ringArea(poly) < 0 ? [...poly].reverse() : poly);

// Sutherland–Hodgman: subject ∩ convex clip polygon.
export function clipConvex(subject, clip) {
  let out = clockwise(subject);
  const c = clockwise(clip);
  for (let i = 0; i < c.length && out.length; i++) out = clipHalfPlane(out, c[i], c[(i + 1) % c.length]);
  return out;
}

// Convex polygon shrunk by d (intersection of inward-shifted edge half-planes).
export function insetConvex(poly, d) {
  const P = clockwise(poly);
  let out = P;
  for (let i = 0; i < P.length && out.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const len = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    out = clipHalfPlane(out, [a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d]);
  }
  return out.length >= 3 && Math.abs(ringArea(out)) > 1e-6 ? out : [];
}

// Minkowski sum of a convex polygon and a disc of radius r, as exact lines + arcs.
export function roundedConvexPath(poly, r) {
  const P = dedupe(clockwise(poly));
  if (P.length < 3) return "";
  if (r <= 0) return P.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join("") + "Z";
  const N = P.length;
  const normal = (i) => {
    const a = P[i], b = P[(i + 1) % N], len = dist(a, b) || 1;
    return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  };
  let d = "";
  for (let i = 0; i < N; i++) {
    const a = P[i], b = P[(i + 1) % N], nm = normal(i), nn = normal((i + 1) % N);
    const s = [a[0] + nm[0] * r, a[1] + nm[1] * r], e = [b[0] + nm[0] * r, b[1] + nm[1] * r];
    const f = [b[0] + nn[0] * r, b[1] + nn[1] * r];
    d += `${i ? "L" : "M"}${n(s[0])} ${n(s[1])}L${n(e[0])} ${n(e[1])}A${n(r)} ${n(r)} 0 0 1 ${n(f[0])} ${n(f[1])}`;
  }
  return d + "Z";
}

function dedupe(P) {
  return P.filter((p, i) => dist(p, P[(i + 1) % P.length]) > 1e-6);
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
