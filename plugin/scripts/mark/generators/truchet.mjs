// Truchet tiles on an n×n grid: Smith quarter-arc bands or half-square triangles,
// seeded orientation, merged into one outline and clipped to a container.
import { rng, n as r3 } from "../../lib/svg.mjs";
import { circlePath } from "../geom.mjs";
import { smoothRectPath } from "./container.mjs";
import { finish, union, intersect, fromGeom, geomArea } from "./boolean.mjs";

// Annular sector between radii a < b around (cx, cy) from angle t0 to t0 + 90°.
function band(cx, cy, a, b, t0) {
  const t1 = t0 + Math.PI / 2;
  const P = (r, t) => `${r3(cx + r * Math.cos(t))} ${r3(cy + r * Math.sin(t))}`;
  return `M${P(b, t0)}A${r3(b)} ${r3(b)} 0 0 1 ${P(b, t1)}L${P(a, t1)}A${r3(a)} ${r3(a)} 0 0 0 ${P(a, t0)}Z`;
}

export function tiles(n, rand) {
  return Array.from({ length: n * n }, () => Math.floor(rand() * 4));
}

export const name = "truchet";
export const description = "Seeded Truchet tiling (quarter-arc bands or half-square triangles) merged into one path and clipped to a circle or rounded square.";
export const params = {
  n: { default: 3, min: 2, max: 12, doc: "tiles per side" },
  tile: { default: "arc", enum: ["arc", "triangle"], doc: "Smith quarter arcs or Truchet's triangles" },
  weight: { default: 0.34, min: 0.1, max: 0.9, doc: "arc band width as a fraction of the tile" },
  size: { default: 780, min: 300, max: 960, doc: "grid side" },
  container: { default: "circle", enum: ["circle", "square", "none"], doc: "clip shape" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p, seed = 1) {
  const N = Math.round(p.n), S = p.size, t = S / N, x0 = 500 - S / 2, y0 = 500 - S / 2;
  const orient = tiles(N, rng(seed));
  const parts = [];
  const construction = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + i * t, y = y0 + j * t, o = orient[j * N + i];
    if (p.tile === "arc") {
      const a = t / 2 - (p.weight * t) / 2, b = t / 2 + (p.weight * t) / 2;
      const corners = o % 2 ? [[x, y, 0], [x + t, y + t, Math.PI]] : [[x + t, y, Math.PI / 2], [x, y + t, -Math.PI / 2]];
      for (const [cx, cy, t0] of corners) {
        parts.push(band(cx, cy, a, b, t0));
        construction.push({ type: "circle", cx, cy, r: t / 2 });
      }
    } else {
      const c = [[x, y], [x + t, y], [x + t, y + t], [x, y + t]];
      const tri = [c[o], c[(o + 1) % 4], c[(o + 2) % 4]];
      parts.push(`M${tri.map(([u, v]) => `${r3(u)} ${r3(v)}`).join("L")}Z`);
    }
  }
  for (let k = 0; k <= N; k++) {
    construction.push({ type: "line", x1: x0 + k * t, y1: y0, x2: x0 + k * t, y2: y0 + S }, { type: "line", x1: x0, y1: y0 + k * t, x2: x0 + S, y2: y0 + k * t });
  }
  let g = union(...parts);
  if (p.container === "circle") g = intersect(g, circlePath(500, 500, S / 2));
  else if (p.container === "square") g = intersect(g, smoothRectPath(x0, y0, S, S, S * 0.18, 0.6));
  // Edge clipping leaves slivers; a fragment smaller than a short stub of band is noise.
  const minArea = p.tile === "arc" ? (p.weight * t) ** 2 * 1.2 : (t * t) / 8;
  g = g.filter((poly) => geomArea([poly]) >= minArea);
  return finish([{ d: fromGeom(g), fill: p.fill, fillRule: "evenodd" }], construction, { tiles: N * N });
}
