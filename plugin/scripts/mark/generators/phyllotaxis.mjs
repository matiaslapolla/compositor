// Vogel phyllotaxis: θₙ = n·137.508°, rₙ = c·√n, dots clipped to a container.
import { finish, intersect, union, fromGeom } from "./boolean.mjs";
import { circlePath } from "../geom.mjs";
import { smoothRectPath, lamePath } from "./container.mjs";

export const GOLDEN_ANGLE = 137.50776405003785;

export function vogel(count, c, { angle = GOLDEN_ANGLE, cx = 500, cy = 500, start = 1 } = {}) {
  const a = (angle * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const k = i + start, r = c * Math.sqrt(k);
    return { x: cx + r * Math.cos(k * a), y: cy + r * Math.sin(k * a), n: k, r };
  });
}

const containerPath = (kind, R) =>
  kind === "circle" ? circlePath(500, 500, R) : kind === "squircle" ? lamePath(500, 500, R, R, 4) : smoothRectPath(500 - R, 500 - R, 2 * R, 2 * R, R * 0.3, 0.6);

export const name = "phyllotaxis";
export const description = "Sunflower packing (Vogel model) of dots that grow outward, clipped to a circle, squircle or rounded square. Large sizes only: dots merge below 32 px, pair it with a glyph for favicons.";
export const params = {
  count: { default: 34, min: 3, max: 1000, doc: "dots before clipping" },
  radius: { default: 400, min: 100, max: 480, doc: "container radius" },
  container: { default: "circle", enum: ["circle", "squircle", "square"], doc: "clip shape" },
  clip: { default: "drop", enum: ["drop", "cut"], doc: "drop = keep whole dots only; cut = slice dots at the edge" },
  angle: { default: GOLDEN_ANGLE, min: 100, max: 180, doc: "divergence angle in degrees" },
  dot: { default: 1.2, min: 0.2, max: 1.6, doc: "outer dot diameter as a fraction of the spacing c (above ~1.4 dots touch)" },
  grow: { default: 0.4, min: 0, max: 1, doc: "inner dots shrink by this fraction toward the centre" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p) {
  const R = p.radius;
  // The outermost dot touches the container, so a circle drops nothing and stays round.
  const c = (R * 0.98) / (Math.sqrt(p.count) + p.dot / 2);
  const all = vogel(p.count, c, { angle: p.angle });
  const rMax = all.at(-1).r || 1;
  const dots = all.map((d) => ({ ...d, s: ((p.dot * c) / 2) * (1 - p.grow + p.grow * Math.sqrt(d.r / rMax)) }));
  const box = containerPath(p.container, R);
  const inside = (d) => (p.container === "circle" ? Math.hypot(d.x - 500, d.y - 500) + d.s <= R : Math.max(Math.abs(d.x - 500), Math.abs(d.y - 500)) + d.s <= R * 0.94);
  const kept = p.clip === "drop" ? dots.filter(inside) : dots;
  const paths = kept.map((d) => circlePath(d.x, d.y, d.s));
  const d = p.clip === "cut" ? fromGeom(intersect(union(...paths), box)) : paths.join("");
  const construction = [{ type: "circle", cx: 500, cy: 500, r: R }, ...[1, 2, 3].map((k) => ({ type: "circle", cx: 500, cy: 500, r: (R * k) / 4 }))];
  return finish([{ d, fill: p.fill, fillRule: "nonzero" }], construction, { points: kept.length, spacing: c });
}
