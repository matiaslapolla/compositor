// Mark composition: generator + layers → optically centred, brand-coloured SVG.
// Also the derived variants (mono, construction), the outlined wordmark and lockups.
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { createRequire } from "node:module";
import { el, n, bbox } from "../lib/svg.mjs";
import { hexOf, normalizeColor, fromOklch } from "../lib/color.mjs";
import { GENERATORS } from "./generators/index.mjs";
import { union, difference, intersect, fromGeom, measure, toGeom } from "./generators/boolean.mjs";
import { unitGrid } from "./generators/grid.mjs";
import { transformD, flattenPath } from "./geom.mjs";

const require = createRequire(import.meta.url);

const FALLBACK_ROLES = {
  light: { bg: "#ffffff", fg: "#111111", accent: "#111111", "accent-fg": "#ffffff", muted: "#6b6b6b", surface: "#f5f5f5", border: "#e5e5e5" },
  dark: { bg: "#0b0b0c", fg: "#f5f5f5", accent: "#f5f5f5", "accent-fg": "#0b0b0c", muted: "#9a9a9a", surface: "#161618", border: "#2a2a2c" },
};

export function rolesOf(brand, mode = "light") {
  const roles = brand?.color?.roles?.[mode] ?? brand?.color?.roles?.light;
  const out = { ...FALLBACK_ROLES[mode] };
  if (roles) for (const [k, v] of Object.entries(roles)) out[k] = typeof v === "string" ? hexOf(v) : v?.hex ?? out[k];
  return out;
}

// role:<name> → brand hex; shade:<k> → accent with OKLCH lightness × k; hex stays.
export function resolveFill(value, roles) {
  if (!value || value === "none") return "none";
  if (value.startsWith("role:")) {
    const hex = roles[value.slice(5)];
    if (!hex) throw new Error(`mark: brand has no colour role "${value.slice(5)}"`);
    return hex;
  }
  if (value.startsWith("shade:")) {
    const k = Number(value.slice(6));
    const [l, c, h] = normalizeColor(roles.accent).oklch;
    return fromOklch([l * k, c, h]).hex;
  }
  const hex = hexOf(value);
  if (!hex) throw new Error(`mark: unreadable fill "${value}"`);
  return hex;
}

export function resolveParams(gen, given = {}, optical = {}) {
  const out = {};
  for (const [key, def] of Object.entries(gen.params)) {
    let v = given[key] ?? (key === "overshoot" && optical.overshoot !== undefined ? optical.overshoot : def.default);
    if (def.enum && !def.enum.includes(v)) throw new Error(`mark: ${gen.name}.${key} must be one of ${def.enum.join("|")}, got ${JSON.stringify(v)}`);
    if (typeof def.default === "number" && typeof v === "number") {
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
    }
    out[key] = v;
  }
  for (const key of Object.keys(given)) if (!(key in gen.params)) throw new Error(`mark: ${gen.name} has no param "${key}" (have ${Object.keys(gen.params).join(", ")})`);
  return out;
}

function run(generator, params, seed, optical) {
  const gen = GENERATORS[generator];
  if (!gen) throw new Error(`mark: unknown generator "${generator}" (have ${Object.keys(GENERATORS).join(", ")})`);
  return gen.generate(resolveParams(gen, params, optical), seed ?? 1);
}

const painted = (e) => e.fill && e.fill !== "none";

function applyLayer(elements, layerOut, op) {
  if (op === "over") return [...elements, ...layerOut.elements];
  const lg = union(...layerOut.elements.filter(painted).map((e) => toGeom(e)));
  if (op === "union") {
    const [first, ...rest] = elements;
    return [{ ...first, d: fromGeom(union(first, lg)), fillRule: "evenodd" }, ...rest];
  }
  const fn = op === "difference" ? difference : op === "intersect" ? intersect : null;
  if (!fn) throw new Error(`mark: layer op must be union|difference|intersect|over, got "${op}"`);
  return elements.map((e) => (painted(e) ? { ...e, d: fromGeom(fn(e, lg)), fillRule: "evenodd" } : e)).filter((e) => e.d);
}

function transformConstruction(items, { s, tx, ty }) {
  return items.map((c) =>
    c.type === "circle"
      ? { ...c, cx: c.cx * s + tx, cy: c.cy * s + ty, r: c.r * s }
      : { ...c, x1: c.x1 * s + tx, y1: c.y1 * s + ty, x2: c.x2 * s + tx, y2: c.y2 * s + ty },
  );
}

// spec → { svg, elements, meta }. Elements keep symbolic fills; svg has hex.
export function buildMark(spec, brand) {
  const optical = { centre: true, overshoot: 0.02, bias: 0.02, ...(spec.optical ?? {}) };
  const base = run(spec.generator, spec.params, spec.seed, optical);
  let elements = base.elements.map((e) => ({ ...e }));
  let construction = [...(base.meta.construction ?? [])];
  for (const layer of spec.layers ?? []) {
    const out = run(layer.generator, layer.params, layer.seed ?? spec.seed, optical);
    elements = applyLayer(elements, out, layer.op ?? "over");
    construction = construction.concat(out.meta.construction ?? []);
  }
  let m = measure(elements);
  let t = { s: 1, tx: 0, ty: 0 };
  if (optical.centre && m.area > 0) {
    const b = m.bbox;
    const s = optical.fit ? (optical.fit * 1000) / Math.max(b.width, b.height) : 1;
    const cx = m.centroid.x * s, cy = m.centroid.y * s;
    t = { s, tx: 500 - cx, ty: 500 - optical.bias * b.height * s - cy };
    // Never let centring push paint off the canvas: shrink about the target until it fits.
    const box = { minX: b.minX * s + t.tx, maxX: b.maxX * s + t.tx, minY: b.minY * s + t.ty, maxY: b.maxY * s + t.ty };
    const over = Math.max(0, -box.minX, box.maxX - 1000, -box.minY, box.maxY - 1000);
    if (over > 0) {
      const ox = 500, oy = 500 - optical.bias * b.height * s;
      const k = Math.min(...[[ox, box.minX, box.maxX, 1000], [oy, box.minY, box.maxY, 1000]].map(([o, lo, hi]) => Math.min((o - 0) / (o - lo || 1), (1000 - o) / (hi - o || 1), 1)));
      t = { s: s * k, tx: ox - (ox - t.tx) * k, ty: oy - (oy - t.ty) * k };
    }
    elements = elements.map((e) => ({ ...e, d: transformD(e.d, t), strokeWidth: e.strokeWidth ? e.strokeWidth * t.s : e.strokeWidth }));
    construction = transformConstruction(construction, t);
    m = measure(elements);
  }
  const mode = spec.colors?.mode ?? "light";
  const roles = rolesOf(brand, mode);
  const svg = markSvg(elements, roles);
  const meta = {
    ...base.meta,
    generator: spec.generator,
    seed: spec.seed ?? 1,
    centroid: m.centroid,
    bbox: m.bbox,
    area: m.area,
    construction,
    transform: { s: n(t.s), tx: n(t.tx), ty: n(t.ty) },
    fills: [...new Set(elements.filter(painted).map((e) => e.fill))],
  };
  return { svg, elements, meta, roles };
}

export const composeMark = (spec, brand) => buildMark(spec, brand).svg;

export function markSvg(elements, roles, { size = 1000 } = {}) {
  const paths = elements.map((e) =>
    el("path", {
      d: e.d,
      fill: resolveFill(e.fill ?? "none", roles),
      "fill-rule": e.fillRule === "evenodd" ? "evenodd" : undefined,
      stroke: e.stroke ? resolveFill(e.stroke, roles) : undefined,
      "stroke-width": e.strokeWidth ? n(e.strokeWidth) : undefined,
    }),
  );
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1000 1000", width: size, height: size }, "\n" + paths.join("\n") + "\n") + "\n";
}

// Every paint (fill and stroke, except none) → one hex.
export function monoVariant(svgText, hex) {
  const h = hexOf(hex);
  return svgText
    .replace(/\b(fill|stroke)="(?!none")[^"]*"/g, `$1="${h}"`)
    .replace(/\b(fill|stroke):\s*(?!none)[^;"]+/g, `$1:${h}`);
}

// Mark + unit grid + generating circles/lines at 40% opacity in one colour.
export function constructionVariant(svgText, meta, { color, divisions } = {}) {
  const c = hexOf(color ?? svgText.match(/fill="(#[0-9a-f]{6})"/i)?.[1] ?? "#e5484d");
  const grid = unitGrid(divisions ?? meta?.grid?.divisions ?? 24);
  const line = (l, w) => el("line", { x1: n(l.x1), y1: n(l.y1), x2: n(l.x2), y2: n(l.y2), "stroke-width": w });
  const items = [
    ...grid.map((l) => line(l, l.weight === 2 ? 1.5 : 0.75)),
    ...(meta?.construction ?? []).map((g) =>
      g.type === "circle" ? el("circle", { cx: n(g.cx), cy: n(g.cy), r: n(g.r), "stroke-width": 2 }) : line(g, 2),
    ),
  ];
  const overlay = el("g", { fill: "none", stroke: c, opacity: 0.4, "data-layer": "construction" }, "\n" + items.join("\n") + "\n");
  return svgText.replace(/<\/svg>\s*$/, overlay + "\n</svg>\n");
}

// ---------- wordmark ----------

export function loadFont(fontFile) {
  if (!fontFile) throw new Error("wordmark: no font file given (pass --font path/to/font.ttf|.otf|.woff)");
  if (!existsSync(fontFile)) throw new Error(`wordmark: font file not found: ${fontFile}`);
  const ext = extname(fontFile).toLowerCase();
  if (ext === ".woff2") throw new Error(`wordmark: ${fontFile} is WOFF2, which opentype.js cannot read; convert it first (python -m fontTools.ttLib.woff2 decompress ${fontFile}) or pass the .ttf/.otf/.woff`);
  if (![".ttf", ".otf", ".woff"].includes(ext)) throw new Error(`wordmark: unsupported font type "${ext}" (use .ttf, .otf or .woff)`);
  const opentype = require("opentype.js");
  const buf = readFileSync(fontFile);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// Text → one outlined path. Tracking in 1/1000 em. Returns an SVG whose root carries
// data-cap-height and data-baseline (viewBox units) for lockups.
export function wordmark(text, fontFile, { size = 200, tracking = 0, fill = "#111111" } = {}) {
  if (!text) throw new Error("wordmark: empty text");
  const font = loadFont(fontFile);
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  let x = 0, d = "";
  glyphs.forEach((g, i) => {
    d += commandsToD(g.getPath(x, 0, size).commands);
    x += (g.advanceWidth ?? 0) * scale + (tracking / 1000) * size;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  if (!d) throw new Error(`wordmark: font ${fontFile} produced no outlines for "${text}"`);
  const capUnits = font.tables.os2?.sCapHeight || font.charToGlyph("H").getBoundingBox().y2;
  const cap = capUnits * scale;
  const b = bbox(flattenPath(d, 0.5).flatMap((r) => r.points));
  const top = Math.min(b.minY, -cap), bottom = Math.max(b.maxY, 0);
  const shifted = transformD(d, { tx: -b.minX, ty: -top });
  const w = b.maxX - b.minX, h = bottom - top;
  return el("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${n(w)} ${n(h)}`,
    width: n(w),
    height: n(h),
    "data-cap-height": n(cap),
    "data-baseline": n(-top),
  }, "\n" + el("path", { d: shifted, fill }) + "\n") + "\n";
}

// opentype's own toPathData mangles coordinates carrying float noise (e.g. 350.20000000000005).
function commandsToD(commands) {
  return commands.map((c) =>
    c.type === "Z" ? "Z"
    : c.type === "Q" ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
    : c.type === "C" ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
    : `${c.type}${n(c.x)} ${n(c.y)}`).join("");
}

// ---------- lockups ----------

export function readSvgPaths(svgText) {
  return [...svgText.matchAll(/<path\b([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]])));
}

const attrNum = (svgText, name) => {
  const m = svgText.match(new RegExp(`${name}="([-\\d.]+)"`));
  return m ? Number(m[1]) : null;
};

function pathsMeasure(paths) {
  const els = paths.map((a) => ({ d: a.d, fill: a.fill ?? "#000", fillRule: a["fill-rule"] }));
  return measure(els.filter((e) => e.fill !== "none"));
}

const pathEl = (a, d) => el("path", { d, fill: a.fill, "fill-rule": a["fill-rule"], stroke: a.stroke, "stroke-width": a["stroke-width"] });

// Horizontal: wordmark cap height = ratio × mark height, cap middle on the mark's optical centre.
// Stacked: wordmark centred under the mark. gap and clearSpace are in mark heights.
export function lockup(markText, wordmarkText, { layout = "horizontal", gap, clearSpace = 0.25, ratio } = {}) {
  const mark = readSvgPaths(markText), word = readSvgPaths(wordmarkText);
  if (!mark.length || !word.length) throw new Error("lockup: mark or wordmark has no paths");
  const mm = pathsMeasure(mark);
  const Hm = mm.bbox.height;
  const cap = attrNum(wordmarkText, "data-cap-height"), baseline = attrNum(wordmarkText, "data-baseline");
  const [, , ww] = (wordmarkText.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 0 0").split(/\s+/).map(Number);
  if (!cap || baseline === null) throw new Error("lockup: wordmark svg lacks data-cap-height/data-baseline (make it with wordmark())");
  let tw;
  if (layout === "horizontal") {
    const k = ((ratio ?? 0.56) * Hm) / cap;
    const g = (gap ?? 0.42) * Hm;
    const tx = mm.bbox.maxX + g, ty = mm.centroid.y + (cap * k) / 2 - baseline * k;
    tw = { s: k, tx, ty };
  } else if (layout === "stacked") {
    let k = ((ratio ?? 0.3) * Hm) / cap;
    k = Math.min(k, (mm.bbox.width * 1.8) / ww);
    const g = (gap ?? 0.3) * Hm;
    const tx = mm.bbox.minX + mm.bbox.width / 2 - (ww * k) / 2, ty = mm.bbox.maxY + g;
    tw = { s: k, tx, ty };
  } else throw new Error(`lockup: layout must be horizontal|stacked, got "${layout}"`);
  const items = [...mark.map((a) => pathEl(a, a.d)), ...word.map((a) => pathEl(a, transformD(a.d, tw)))];
  const all = bbox([
    [mm.bbox.minX, mm.bbox.minY], [mm.bbox.maxX, mm.bbox.maxY],
    ...word.flatMap((a) => flattenPath(transformD(a.d, tw), 0.5).flatMap((r) => r.points)),
  ]);
  const pad = clearSpace * Hm;
  const t = { s: 1, tx: -all.minX + pad, ty: -all.minY + pad };
  const W = all.width + 2 * pad, H = all.height + 2 * pad;
  const body = items.map((p) => p.replace(/ d="([^"]*)"/, (_, d) => ` d="${transformD(d, t)}"`));
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${n(W)} ${n(H)}`, width: n(W), height: n(H) }, "\n" + body.join("\n") + "\n") + "\n";
}
