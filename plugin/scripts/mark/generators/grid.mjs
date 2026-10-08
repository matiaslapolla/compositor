// Unit grid and golden-rectangle construction. The construction is metadata for
// boards; the element layer turns the golden subdivision into a mark.
import { n } from "../../lib/svg.mjs";
import { PHI } from "../geom.mjs";
import { finish, strokeOutline, union, fromGeom } from "./boolean.mjs";

// Canvas unit grid: u = 1000 / divisions, plus bounding square, crosshair and diagonals.
export function unitGrid(divisions = 24, { size = 1000 } = {}) {
  const u = size / divisions, lines = [];
  for (let i = 0; i <= divisions; i++) {
    lines.push({ type: "line", x1: i * u, y1: 0, x2: i * u, y2: size, weight: i % (divisions / 4) ? 1 : 2 });
    lines.push({ type: "line", x1: 0, y1: i * u, x2: size, y2: i * u, weight: i % (divisions / 4) ? 1 : 2 });
  }
  lines.push({ type: "line", x1: 0, y1: 0, x2: size, y2: size }, { type: "line", x1: size, y1: 0, x2: 0, y2: size });
  return lines;
}

// Golden rectangle split into squares; each square carries the quarter arc of the spiral.
export function goldenSquares(x, y, w, depth) {
  let h = w / PHI;
  let r = { x, y, w, h };
  const out = [];
  for (let k = 0; k < depth; k++) {
    const o = k % 4;
    let sq, centre, from, to;
    if (o === 0) { const s = r.h; sq = { x: r.x, y: r.y, s }; centre = [r.x + s, r.y + s]; from = [r.x, r.y + s]; to = [r.x + s, r.y]; r = { x: r.x + s, y: r.y, w: r.w - s, h: r.h }; }
    else if (o === 1) { const s = r.w; sq = { x: r.x, y: r.y, s }; centre = [r.x, r.y + s]; from = [r.x, r.y]; to = [r.x + s, r.y + s]; r = { x: r.x, y: r.y + s, w: r.w, h: r.h - s }; }
    else if (o === 2) { const s = r.h; sq = { x: r.x + r.w - s, y: r.y, s }; centre = [r.x + r.w - s, r.y]; from = [r.x + r.w, r.y]; to = [r.x + r.w - s, r.y + s]; r = { x: r.x, y: r.y, w: r.w - s, h: r.h }; }
    else { const s = r.w; sq = { x: r.x, y: r.y + r.h - s, s }; centre = [r.x + s, r.y + r.h - s]; from = [r.x + s, r.y + r.h]; to = [r.x, r.y + r.h - s]; r = { x: r.x, y: r.y, w: r.w, h: r.h - s }; }
    out.push({ ...sq, centre, from, to, orient: o });
  }
  return out;
}

const arcPoints = ({ centre, from, to, s }, steps) => {
  const a0 = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  let a1 = Math.atan2(to[1] - centre[1], to[0] - centre[0]);
  while (a1 < a0) a1 += Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [centre[0] + s * Math.cos(a), centre[1] + s * Math.sin(a)];
  });
};

export function goldenConstruction(squares) {
  const c = [];
  for (const q of squares) {
    c.push({ type: "line", x1: q.x, y1: q.y, x2: q.x + q.s, y2: q.y }, { type: "line", x1: q.x + q.s, y1: q.y, x2: q.x + q.s, y2: q.y + q.s });
    c.push({ type: "line", x1: q.x + q.s, y1: q.y + q.s, x2: q.x, y2: q.y + q.s }, { type: "line", x1: q.x, y1: q.y + q.s, x2: q.x, y2: q.y });
    c.push({ type: "circle", cx: q.centre[0], cy: q.centre[1], r: q.s });
  }
  return c;
}

export const name = "grid";
export const description = "Unit grid (u = 1/16 or 1/24) and golden-rectangle subdivision. Draws the golden sectors, the tapered spiral or the square tiles; always returns the construction.";
export const params = {
  divisions: { default: 24, enum: [16, 24], doc: "unit grid divisions of the canvas" },
  layer: { default: "sectors", enum: ["sectors", "spiral", "squares", "none"], doc: "element layer drawn from the golden subdivision" },
  width: { default: 800, min: 300, max: 960, doc: "golden rectangle width" },
  depth: { default: 5, min: 2, max: 9, doc: "number of golden squares" },
  gap: { default: 16, min: 0, max: 60, doc: "gap between tiles (sectors, squares)" },
  weight: { default: 0.2, min: 0.04, max: 0.5, doc: "spiral band width as a fraction of each square's side (tapers with φ)" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const w = p.width, h = w / PHI, x = 500 - w / 2, y = 500 - h / 2;
  const squares = goldenSquares(x, y, w, p.depth);
  const construction = [...goldenConstruction(squares), { type: "line", x1: x, y1: y, x2: x + w, y2: y }, { type: "line", x1: x, y1: y + h, x2: x + w, y2: y + h }];
  const elements = [];
  const g = p.gap / 2;
  if (p.layer === "sectors") {
    const d = squares.map((q) => {
      const [cx, cy] = q.centre, s = q.s - g * 2;
      const ix = q.x + g, iy = q.y + g;
      const cxi = cx === q.x ? ix : ix + s, cyi = cy === q.y ? iy : iy + s;
      const f = [q.from[0] === q.x ? ix : ix + s, q.from[1] === q.y ? iy : iy + s];
      const t = [q.to[0] === q.x ? ix : ix + s, q.to[1] === q.y ? iy : iy + s];
      return `M${n(cxi)} ${n(cyi)}L${n(f[0])} ${n(f[1])}A${n(s)} ${n(s)} 0 0 1 ${n(t[0])} ${n(t[1])}Z`;
    }).join("");
    elements.push({ d, fill: p.fill });
  } else if (p.layer === "squares") {
    const d = squares.map((q) => `M${n(q.x + g)} ${n(q.y + g)}h${n(q.s - 2 * g)}v${n(q.s - 2 * g)}h${n(-(q.s - 2 * g))}Z`).join("");
    elements.push({ d, fill: p.fill });
  } else if (p.layer === "spiral") {
    const pts = [], widths = [];
    squares.forEach((q, k) => {
      const arc = arcPoints(q, 48);
      arc.forEach((pt, i) => {
        if (k && !i) return;
        pts.push(pt);
        widths.push(p.weight * q.s * PHI ** (-i / 48));
      });
    });
    elements.push({ d: fromGeom(union(strokeOutline(pts, (_, i) => widths[i]))), fill: p.fill, fillRule: "evenodd" });
  }
  return finish(elements, construction, { grid: { divisions: p.divisions, unit: 1000 / p.divisions } });
}
