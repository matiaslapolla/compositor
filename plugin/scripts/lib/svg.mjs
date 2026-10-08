// Minimal deterministic SVG string builder. Numbers are rounded to 3 decimals.
export const n = (v) => (Math.abs(v) < 5e-4 ? 0 : Number(v.toFixed(3)));

export function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
}

export const el = (tag, a = {}, children = "") => {
  const body = Array.isArray(children) ? children.join("") : children;
  const open = `<${tag}${Object.keys(a).length ? " " + attrs(a) : ""}`;
  return body ? `${open}>${body}</${tag}>` : `${open}/>`;
};

export function svg({ width = 1000, height = 1000, viewBox, children = [], extra = {} }) {
  return el(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: viewBox ?? `0 0 ${width} ${height}`, ...extra },
    Array.isArray(children) ? children.join("\n") : children,
  );
}

// Polyline of points → closed or open path data.
export function pathFromPoints(points, { close = true } = {}) {
  if (!points.length) return "";
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join("");
  return close ? d + "Z" : d;
}

// Catmull-Rom → cubic Bézier smoothing of a closed polyline (tension 0.5).
export function smoothClosedPath(points) {
  const P = points.length;
  if (P < 3) return pathFromPoints(points);
  let d = `M${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 0; i < P; i++) {
    const p0 = points[(i - 1 + P) % P], p1 = points[i], p2 = points[(i + 1) % P], p3 = points[(i + 2) % P];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d + "Z";
}

// Deterministic PRNG (mulberry32) so a seed reproduces a pattern exactly.
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Area centroid of a simple polygon (shoelace). Used for optical centring.
export function centroid(points) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a *= 0.5;
  return a === 0 ? bboxCenter(points) : { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}
const bboxCenter = (pts) => { const b = bbox(pts); return { x: b.cx, y: b.cy, area: 0 }; };
