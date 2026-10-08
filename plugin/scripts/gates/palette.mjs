// Colours in the authored project and in rendered pixels must come from the brand.
// (a) static: every literal in project/*.html and project/**/*.css within ΔE_OK 0.02 of a role.
// (b) sampled: dominant colour clusters (>= 2% of pixels) of rendered PNGs within ΔE 0.06
//     of a role, or within 0.04 of a two-role blend (anti-aliasing, glows, translucent layers).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { converter, formatHex, parse } from "culori";
import { hexesIn } from "../lib/color.mjs";
import { walk } from "../lib/fs.mjs";
import { loadSharp } from "../lib/browser.mjs";
import { finding, result, skip, cli, isMain } from "./common.mjs";

const GATE = "palette";
const STATIC_TOL = 0.02;
const SAMPLED_TOL = 0.06;
const BLEND_TOL = 0.04;
const MIN_SHARE = 0.02;
const CLUSTER_TOL = 0.04;
const MAX_CLUSTERS = 64;
const FRAMES_PER_DIR = 5;

const toLab = converter("oklab");
const lab = (c) => {
  const o = toLab(typeof c === "string" ? parse(c) : c);
  return [o.l, o.a, o.b];
};
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const round = (v, d = 4) => Number(v.toFixed(d));

export function brandRoles(brand) {
  const seen = new Map();
  const add = (name, value) => {
    const hex = typeof value === "string" ? value : value?.hex;
    if (!hex || seen.has(hex)) return;
    seen.set(hex, { name, hex, lab: lab(hex) });
  };
  for (const scope of ["light", "dark"]) {
    for (const [role, value] of Object.entries(brand?.color?.roles?.[scope] ?? {})) add(`${scope}.${role}`, value);
  }
  add("video.nearBlack", brand?.color?.video?.nearBlack);
  return [...seen.values()];
}

export function nearestRole(p, roles) {
  let best = { role: null, d: Infinity };
  for (const r of roles) {
    const d = dist(p, r.lab);
    if (d < best.d) best = { role: r, d };
  }
  return best;
}

// Distance to the closest two-role mix: the OKLab segment and the gamma-sRGB
// mix browsers composite with (they differ for chromatic pairs).
export function blendDistance(p, roles) {
  let best = Infinity;
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      const a = roles[i].lab, b = roles[j].lab;
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2)) : 0;
      best = Math.min(best, dist(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]));
      for (const q of srgbMix(roles[i], roles[j])) best = Math.min(best, dist(p, q));
    }
  }
  return best;
}

const mixCache = new Map();
function srgbMix(a, b) {
  const key = a.hex + b.hex;
  if (!mixCache.has(key)) {
    const ca = parse(a.hex), cb = parse(b.hex);
    const pts = [];
    for (let k = 1; k < 20; k++) {
      const t = k / 20;
      pts.push(lab({ mode: "rgb", r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t }));
    }
    mixCache.set(key, pts);
  }
  return mixCache.get(key);
}

// Translucent pure black/white (shadows, scrims) are helpers, not palette colours.
export function stripTranslucentHelpers(text) {
  return text.replace(/#(?:[0-9a-f]{4}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/gi, (m) => {
    const c = parse(m);
    if (!c || c.alpha === undefined || c.alpha >= 1) return m;
    const hex = formatHex(c);
    return hex === "#000000" || hex === "#ffffff" ? "" : m;
  });
}

export function staticOffenders(text, roles) {
  const out = [];
  for (const hex of hexesIn(stripTranslucentHelpers(text))) {
    const { role, d } = nearestRole(lab(hex), roles);
    if (d > STATIC_TOL) out.push({ hex, nearest: role?.name ?? null, nearestHex: role?.hex ?? null, deltaE: round(d) });
  }
  return out;
}

// Dominant colours: 64-px-wide downscale, 4-bit buckets, greedy merge of
// buckets within ΔE 0.04 of a cluster seed (largest first). The linear kernel
// never overshoots: lanczos rings at hard light/dark edges and invents colours
// darker than the background.
export async function dominantColors(path) {
  const sharp = loadSharp();
  const { data, info } = await sharp(path).resize({ width: 64, kernel: "linear" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    s.n++; s.r += r; s.g += g; s.b += b;
    buckets.set(key, s);
    total++;
  }
  if (!total) return [];
  const sorted = [...buckets.values()].sort((x, y) => y.n - x.n).map((s) => {
    const rgb = { mode: "rgb", r: s.r / s.n / 255, g: s.g / s.n / 255, b: s.b / s.n / 255 };
    return { n: s.n, sum: [s.r, s.g, s.b], lab: lab(rgb) };
  });
  const clusters = [];
  for (const s of sorted) {
    const c = clusters.find((k) => dist(k.seed, s.lab) <= CLUSTER_TOL);
    if (c) {
      c.n += s.n;
      c.sum = c.sum.map((v, i) => v + s.sum[i]);
    } else clusters.push({ seed: s.lab, n: s.n, sum: [...s.sum] });
  }
  return clusters
    .sort((x, y) => y.n - x.n)
    .slice(0, MAX_CLUSTERS)
    .map((c) => {
      const rgb = { mode: "rgb", r: c.sum[0] / c.n / 255, g: c.sum[1] / c.n / 255, b: c.sum[2] / c.n / 255 };
      return { hex: formatHex(rgb), lab: lab(rgb), share: c.n / total };
    });
}

export function offBrand(colors, roles) {
  const out = [];
  for (const c of colors) {
    if (c.share < MIN_SHARE) continue;
    const { role, d } = nearestRole(c.lab, roles);
    if (d <= SAMPLED_TOL) continue;
    const blend = blendDistance(c.lab, roles);
    if (blend <= BLEND_TOL) continue;
    out.push({ hex: c.hex, share: round(c.share, 3), nearest: role?.name ?? null, deltaE: round(d), blendDeltaE: round(blend) });
  }
  return out;
}

const pick = (files, n) => (files.length <= n ? files : Array.from({ length: n }, (_, i) => files[Math.round((i * (files.length - 1)) / (n - 1))]));

export function sampledImages(ctx) {
  const isImg = (rel) => /\.(png|jpe?g|webp)$/i.test(rel);
  const files =
    ctx.stage === "dist"
      ? walk(join(ctx.runDir, "dist"), (rel) => isImg(rel) && !rel.split("/").includes("frames"))
      : walk(join(ctx.runDir, "proof"), (rel, name) => /\.png$/i.test(rel) && !/^sheet/i.test(name));
  const byDir = new Map();
  for (const f of files.sort()) {
    const d = dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  return [...byDir.values()].flatMap((list) => pick(list, FRAMES_PER_DIR));
}

function projectSources(runDir) {
  const project = join(runDir, "project");
  if (!existsSync(project)) return [];
  // project/<target>/index.html per target (build.mjs), or legacy project/*.html.
  return walk(project, (rel) => (rel.endsWith(".html") || rel.endsWith(".css")) && !rel.startsWith("_shared/") && !rel.includes("/fonts/") && !rel.includes("/assets/"), { maxDepth: 3 });
}

export async function run(ctx) {
  if (!ctx.brand) return skip(GATE, "no brand.json");
  const roles = brandRoles(ctx.brand);
  if (!roles.length) return skip(GATE, "brand.json has no colour roles");
  const findings = [];

  const sources = projectSources(ctx.runDir);
  if (!sources.length) findings.push(finding("palette.static", "skip", { reason: "no project/**/index.html or project/**/*.css" }));
  const offenders = new Map();
  for (const file of sources) {
    for (const o of staticOffenders(readFileSync(file, "utf8"), roles)) {
      const prev = offenders.get(o.hex) ?? { ...o, files: [] };
      prev.files.push(relative(ctx.runDir, file));
      offenders.set(o.hex, prev);
    }
  }
  for (const o of offenders.values()) findings.push(finding("palette.static", "fail", o));

  const images = sampledImages(ctx);
  if (!images.length) findings.push(finding("palette.sampled", "skip", { reason: `no rendered images in ${ctx.stage === "dist" ? "dist" : "proof"}/` }));
  // Guide captures are the product's own UI: pixel drift there is reported, not failed.
  const sampledStatus = ctx.mode === "guide" || ctx.plan?.mode === "guide" ? "warn" : "fail";
  for (const file of images) {
    const bad = offBrand(await dominantColors(file), roles);
    if (bad.length) findings.push(finding("palette.sampled", sampledStatus, { file: relative(ctx.runDir, file), colors: bad }));
  }
  return result(GATE, findings, { checked: { sources: sources.length, images: images.length } });
}

if (isMain(import.meta.url)) await cli(run);
