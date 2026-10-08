// Generator registry. Each generator is a pure function of (params, seed); missing
// params take their declared defaults.
import * as container from "./container.mjs";
import * as grid from "./grid.mjs";
import * as monogram from "./monogram.mjs";
import * as boolean from "./boolean.mjs";
import * as metaball from "./metaball.mjs";
import * as phyllotaxis from "./phyllotaxis.mjs";
import * as trochoid from "./trochoid.mjs";
import * as isometric from "./isometric.mjs";
import * as voronoi from "./voronoi.mjs";
import * as truchet from "./truchet.mjs";
import * as fourier from "./fourier.mjs";

const MODULES = [container, grid, monogram, boolean, metaball, phyllotaxis, trochoid, isometric, voronoi, truchet, fourier];

export const withDefaults = (schema, params = {}) => ({
  ...Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])),
  ...params,
});

export const GENERATORS = Object.fromEntries(
  MODULES.map((m) => [m.name, { name: m.name, description: m.description, params: m.params, generate: (params, seed = 1) => m.generate(withDefaults(m.params, params), seed) }]),
);

export function listGenerators() {
  return Object.values(GENERATORS).map(({ name, description, params }) => ({
    name,
    description,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { ...v }])),
  }));
}
