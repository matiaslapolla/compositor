// Voronoi cells (d3-delaunay) from seeded sites, Lloyd-relaxed, clipped to a convex
// container, then inset and corner-rounded as exact lines + arcs.
import { Delaunay } from "d3-delaunay";
import { rng } from "../../lib/svg.mjs";
import { clipConvex, insetConvex, roundedConvexPath, ringCentroid, regularPolygon } from "../geom.mjs";
import { lamePoints } from "./container.mjs";
import { finish } from "./boolean.mjs";

const containerPoly = (kind, R) =>
  kind === "circle" ? regularPolygon(500, 500, R, 96, 0) : kind === "squircle" ? lamePoints(500, 500, R, R, 4, 96) : [[500 - R, 500 - R], [500 + R, 500 - R], [500 + R, 500 + R], [500 - R, 500 + R]];

export function relaxedCells(count, container, iterations, rand) {
  const xs = container.map((q) => q[0]), ys = container.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inside = (x, y) => clipConvex([[x - 0.01, y - 0.01], [x + 0.01, y - 0.01], [x + 0.01, y + 0.01], [x - 0.01, y + 0.01]], container).length > 0;
  let sites = [];
  while (sites.length < count) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    if (inside(x, y)) sites.push([x, y]);
  }
  let cells = [];
  for (let it = 0; it <= iterations; it++) {
    const v = Delaunay.from(sites).voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    cells = sites.map((_, i) => clipConvex((v.cellPolygon(i) ?? []).slice(0, -1), container));
    if (it < iterations) sites = cells.map((c, i) => (c.length >= 3 ? ringCentroid(c) : sites[i]));
  }
  return { sites, cells };
}

export const name = "voronoi";
export const description = "A few Lloyd-relaxed Voronoi cells inside a circle, squircle or square, inset by a gap and rounded: a calm mosaic, not a network.";
export const params = {
  count: { default: 7, min: 2, max: 60, doc: "cells" },
  relax: { default: 6, min: 0, max: 20, doc: "Lloyd iterations (3–8 even out the cells)" },
  container: { default: "circle", enum: ["circle", "squircle", "square"], doc: "clip shape" },
  radius: { default: 400, min: 150, max: 480, doc: "container radius" },
  gap: { default: 28, min: 0, max: 80, doc: "channel width between cells" },
  round: { default: 22, min: 0, max: 80, doc: "cell corner radius" },
  highlight: { default: 0, min: 0, max: 10, doc: "number of cells painted role:fg instead (seeded)" },
  fill: { default: "role:accent", doc: "fill role or hex" },
};

export function generate(p, seed = 1) {
  const rand = rng(seed);
  const box = containerPoly(p.container, p.radius);
  const { sites, cells } = relaxedCells(Math.round(p.count), box, Math.round(p.relax), rand);
  const shapes = cells.map((c) => {
    const core = insetConvex(c, p.gap / 2 + p.round);
    return core.length ? roundedConvexPath(core, p.round) : "";
  });
  const order = sites.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const hi = new Set(order.slice(0, Math.round(p.highlight)));
  const elements = [
    { d: shapes.filter((_, i) => !hi.has(i)).join(""), fill: p.fill },
    { d: shapes.filter((_, i) => hi.has(i)).join(""), fill: "role:fg" },
  ].filter((e) => e.d);
  const construction = [
    { type: "circle", cx: 500, cy: 500, r: p.radius },
    ...sites.map(([x, y]) => ({ type: "circle", cx: x, cy: y, r: 6 })),
  ];
  return finish(elements, construction, { cells: shapes.filter(Boolean).length });
}
