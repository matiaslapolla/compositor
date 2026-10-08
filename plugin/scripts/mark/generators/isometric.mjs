// Isometric primitives: x' = (x − y)·cos30°, y' = (x + y)·sin30° − z. Visible faces
// are resolved by painter's order + boolean difference, separated by a gap so the
// one-colour variant still reads, and filled with three luminance steps.
import { pathFromPoints } from "../../lib/svg.mjs";
import { regularPolygon, TAU } from "../geom.mjs";
import { finish, union, difference, fromGeom, strokeOutline } from "./boolean.mjs";

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
export const iso = ([x, y, z]) => [(x - y) * C30, (x + y) * S30 - z];

// Faces of a right prism over a convex footprint (counter-clockwise in x,y) from z0 to z1.
function prismFaces(foot, z0, z1) {
  const faces = [{ pts: foot.map(([x, y]) => [x, y, z1]), tone: "top", depth: z1 }];
  for (let i = 0; i < foot.length; i++) {
    const a = foot[i], b = foot[(i + 1) % foot.length];
    const nx = b[1] - a[1], ny = -(b[0] - a[0]);
    // The viewer looks along −(1, 1, ·): side faces with a normal toward +x or +y are visible.
    if (nx + ny <= 1e-9) continue;
    const tone = nx >= ny ? "right" : "left";
    faces.push({ pts: [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], tone, depth: z0 });
  }
  return faces;
}

export const TONES = { top: "role:accent", left: "shade:0.8", right: "shade:0.6" };

export const name = "isometric";
export const description = "Isometric cube, slab stack or extruded polygon with three fixed luminance steps (accent, shade 0.8, shade 0.6) and gap-separated faces.";
export const params = {
  shape: { default: "cube", enum: ["cube", "stack", "prism"], doc: "solid" },
  size: { default: 330, min: 50, max: 500, doc: "footprint edge (cube, stack) or circumradius (prism)" },
  height: { default: 1, min: 0.1, max: 3, doc: "height as a fraction of size (cube, prism)" },
  sides: { default: 6, min: 3, max: 12, doc: "prism footprint sides" },
  levels: { default: 3, min: 2, max: 6, doc: "stack: slabs" },
  slab: { default: 0.28, min: 0.08, max: 0.6, doc: "stack: slab thickness as a fraction of size" },
  spacing: { default: 0, min: 0, max: 0.6, doc: "stack: vertical gap between slabs, fraction of size" },
  gap: { default: 16, min: 0, max: 60, doc: "channel between visible faces, viewBox units" },
  fill: { default: "role:accent", doc: "top-face role; sides use shade:0.8 and shade:0.6 of the accent" },
};

export function generate(p) {
  const s = p.size;
  let solids;
  if (p.shape === "cube") solids = [prismFaces([[0, 0], [s, 0], [s, s], [0, s]], 0, s * p.height)];
  else if (p.shape === "prism") solids = [prismFaces(regularPolygon(0, 0, s / 1.2, Math.round(p.sides), Math.PI / 4 + Math.PI / Math.round(p.sides)), 0, (s / 1.2) * p.height * 1.4)];
  else {
    solids = [];
    for (let i = 0; i < p.levels; i++) {
      const z0 = i * s * (p.slab + p.spacing);
      solids.push(prismFaces([[0, 0], [s, 0], [s, s], [0, s]], z0, z0 + s * p.slab));
    }
  }
  // Painter's order: lower solids first; within a solid, sides before top.
  const faces = solids.flatMap((f) => f.sort((a, b) => (a.tone === "top") - (b.tone === "top")));
  const projected = faces.map((f) => ({ ...f, poly: f.pts.map(iso) }));
  const b = projected.flatMap((f) => f.poly);
  const minX = Math.min(...b.map((q) => q[0])), maxX = Math.max(...b.map((q) => q[0]));
  const minY = Math.min(...b.map((q) => q[1])), maxY = Math.max(...b.map((q) => q[1]));
  const ox = 500 - (minX + maxX) / 2, oy = 500 - (minY + maxY) / 2;
  const placed = projected.map((f) => ({ ...f, poly: f.poly.map(([x, y]) => [x + ox, y + oy]) }));
  const visible = placed.map((f, i) => difference(pathFromPoints(f.poly), ...placed.slice(i + 1).map((g) => pathFromPoints(g.poly))));
  const edges = p.gap > 0
    ? union(...visible.flatMap((g) => g.flatMap((poly) => poly.map((ring) => strokeOutline(ring.slice(0, -1), p.gap, { closed: true }))))) : [];
  const groups = { top: [], left: [], right: [] };
  visible.forEach((g, i) => {
    const vis = edges.length ? difference(g, edges) : g;
    if (vis.length) groups[placed[i].tone].push(vis);
  });
  const tones = { ...TONES, top: p.fill };
  const elements = Object.entries(groups)
    .filter(([, g]) => g.length)
    .map(([tone, g]) => ({ d: fromGeom(union(...g)), fill: tones[tone], fillRule: "evenodd" }));
  const R = Math.max(maxX - minX, maxY - minY) / 2;
  const construction = [
    { type: "circle", cx: 500, cy: 500, r: R },
    ...[0, 1, 2].map((k) => {
      const a = -Math.PI / 2 + (k * TAU) / 3;
      return { type: "line", x1: 500, y1: 500, x2: 500 + R * Math.cos(a), y2: 500 + R * Math.sin(a) };
    }),
  ];
  return finish(elements, construction, { faces: placed.length });
}
