// Logo package gate: measures a mark package written by scripts/mark/package.mjs.
// Rasters come from sharp (librsvg), never from a browser.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { loadSharp } from "../lib/browser.mjs";
import { finding, result, skip, isMain, formatResult } from "./common.mjs";

export const PACKAGE_FILES = [
  "logo/mark.svg", "logo/mark-mono-black.svg", "logo/mark-mono-white.svg", "logo/mark-construction.svg",
  "logo/wordmark.svg", "logo/lockup-horizontal.svg", "logo/lockup-stacked.svg",
  ...[16, 32, 64, 128, 256, 512, 1024].map((s) => `raster/mark-${s}.png`),
  ...[256, 512, 1024].map((s) => `raster/mark-${s}.webp`),
  "web/favicon.ico", "web/favicon.svg", "web/apple-touch-icon.png", "web/icon-192.png", "web/icon-512.png",
  "web/icon-maskable-512.png", "web/manifest.webmanifest",
  "social/avatar-400.png", "social/og-1200x630.png", "brand-sheet.png", "manifest.json",
];

// ---------- raster primitives ----------

export function sizedSvg(svgText, w, h = w) {
  return svgText.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/\s(width|height)="[^"]*"/g, "");
    return t.replace(/<svg\b/, `<svg width="${w}" height="${h}"`);
  });
}

export async function rasterize(svgText, size) {
  const sharp = loadSharp();
  const { data, info } = await sharp(Buffer.from(sizedSvg(svgText, size))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export async function decode(buffer) {
  const sharp = loadSharp();
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export function alphaMask({ data, width, height, channels }, threshold = 0.5) {
  const m = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) m[i] = data[i * channels + channels - 1] > threshold * 255 ? 1 : 0;
  return m;
}

export function erode(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let all = 1;
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[(y + dy) * w + x + dx]) { all = 0; break; }
    out[y * w + x] = all;
  }
  return out;
}

// Connected components of pixels equal to `value` (8-connected for ink, 4 for background).
export function components(mask, w, h, { value = 1, connectivity = 8 } = {}) {
  const label = new Int32Array(w * h).fill(-1);
  const out = [];
  const nb = connectivity === 8 ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== value || label[s] !== -1) continue;
    const id = out.length, stack = [s];
    const c = { id, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, border: false, pixels: [] };
    label[s] = id;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      c.area++; c.pixels.push(p);
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] === value && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
    out.push(c);
  }
  return out;
}

export function dilate(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
    }
  }
  return out;
}

// Minimum stroke ≥ 1 px at `size`. The mark is rasterized at 3× (alpha > 0.5) so one
// 3×3 erosion removes one 16-px pixel across. Two numbers per component: the share of ink
// that survives the erosion, and the share kept by the opening (erode → dilate), which
// only loses parts thinner than 1 px. A component fails when its opening keeps < 85%
// of its ink, or when nothing survives erosion at all.
export async function strokeSurvival(svgText, { size = 16, supersample = 3, minKept = 0.85 } = {}) {
  const R = size * supersample;
  const mask = alphaMask(await rasterize(svgText, R));
  const er = erode(mask, R, R), op = dilate(er, R, R);
  const comps = components(mask, R, R).filter((c) => c.area >= supersample * supersample * 0.5);
  const per = comps.map((c) => {
    let e = 0, o = 0;
    for (const p of c.pixels) { e += er[p]; o += op[p]; }
    return { area: c.area, survived: e / c.area, kept: o / c.area };
  });
  const fg = mask.reduce((a, b) => a + b, 0), kept = er.reduce((a, b) => a + b, 0);
  const worstKept = per.length ? Math.min(...per.map((c) => c.kept)) : 0;
  const worst = per.length ? Math.min(...per.map((c) => c.survived)) : 0;
  return { size, supersample, overall: fg ? kept / fg : 0, worst, worstKept, components: per.length, pass: per.length > 0 && worst > 0 && worstKept >= minKept };
}

// Counters at `size`: every enclosed background region that is a real counter at the
// reference size (≥ 1 px across at `size`) must still be open and ≥ 2 px across at `size`.
// Sub-pixel channels (gaps between faces or cells) are not counters and are ignored.
export async function counterCheck(svgText, { size = 32, refSize = 256, minPx = 2 } = {}) {
  const holesAt = async (s) => {
    const img = await rasterize(svgText, s);
    const mask = alphaMask(img);
    return components(mask, s, s, { value: 0, connectivity: 4 }).filter((c) => !c.border);
  };
  const k = refSize / size;
  const small = await holesAt(size);
  const ref = (await holesAt(refSize)).filter((c) => Math.min(c.maxX - c.minX + 1, c.maxY - c.minY + 1) >= k);
  const across = (c) => Math.min(c.maxX - c.minX + 1, c.maxY - c.minY + 1);
  const results = ref.map((c) => {
    const cx = c.pixels.reduce((a, p) => a + (p % refSize), 0) / c.area / k, cy = c.pixels.reduce((a, p) => a + Math.floor(p / refSize), 0) / c.area / k;
    const hit = small.find((h) => cx >= h.minX - 1 && cx <= h.maxX + 2 && cy >= h.minY - 1 && cy <= h.maxY + 2);
    return { expectedPx: Number((across(c) / k).toFixed(2)), px: hit ? across(hit) : 0 };
  });
  const closed = results.filter((r) => !r.px).length, tooSmall = results.filter((r) => r.px && r.px < minPx).length;
  const sizes = results.map((r) => r.px);
  return { size, counters: results.length, open: results.length - closed, minSize: sizes.length ? Math.min(...sizes) : null, tooSmall, closed, results, pass: !tooSmall && !closed };
}

export function forbiddenTags(svgText) {
  return [...new Set([...svgText.matchAll(/<(linearGradient|radialGradient|filter|mask|image|text)\b/g)].map((m) => m[1]))];
}

export function paints(svgText) {
  const out = new Set();
  for (const m of svgText.matchAll(/\b(?:fill|stroke)\s*[=:]\s*"?([^";)\s>]+)/g)) {
    const v = m[1].toLowerCase();
    if (v !== "none" && v !== "transparent") out.add(v);
  }
  return [...out];
}

// Content of an opaque icon = pixels that differ from the corner background colour.
export async function maskableSafe(pngBuffer, { radius = 0.4, tolerance = 1 } = {}) {
  const { data, width, height, channels } = await decode(pngBuffer);
  const bg = [data[0], data[1], data[2]];
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  let maxR = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= 24) continue;
    maxR = Math.max(maxR, Math.hypot(x - cx, y - cy) + 0.5);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const limit = radius * width + tolerance;
  return { maxRadius: Number(maxR.toFixed(2)), limit, ratio: Number((maxR / width).toFixed(4)), bbox: maxX < 0 ? null : { minX, minY, maxX, maxY }, pass: maxX >= 0 && maxR <= limit };
}

// Alpha-weighted centroid vs bbox centre of the ink, as a fraction of bbox size.
export async function centroidOffset(svgText, { size = 512 } = {}) {
  const { data, width, height, channels } = await rasterize(svgText, size);
  let A = 0, X = 0, Y = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = data[(y * width + x) * channels + channels - 1] / 255;
    if (!a) continue;
    A += a; X += a * (x + 0.5); Y += a * (y + 0.5);
    if (a > 0.5) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!A || maxX < 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1, bx = (minX + maxX + 1) / 2, by = (minY + maxY + 1) / 2;
  const cx = X / A, cy = Y / A;
  return {
    centroid: { x: round(cx / size), y: round(cy / size) },
    canvasOffset: { x: round(cx / size - 0.5), y: round(cy / size - 0.5) },
    bboxOffset: { x: round((cx - bx) / bw), y: round((cy - by) / bh) },
    max: round(Math.max(Math.abs(cx - bx) / bw, Math.abs(cy - by) / bh)),
  };
}

// Luminance over white, 0–255.
export function luma({ data, width, height, channels }) {
  const out = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * channels + channels - 1] / 255;
    const l = 0.2126 * data[i * channels] + 0.7152 * data[i * channels + 1] + 0.0722 * data[i * channels + 2];
    out[i] = l * a + 255 * (1 - a);
  }
  return out;
}

// Mean SSIM over 7×7 uniform windows (stride 1).
export function ssim(a, b, w, h, win = 7) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let total = 0, count = 0;
  for (let y = 0; y + win <= h; y++) for (let x = 0; x + win <= w; x++) {
    let ma = 0, mb = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { ma += a[(y + j) * w + x + i]; mb += b[(y + j) * w + x + i]; }
    const N = win * win;
    ma /= N; mb /= N;
    let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) {
      const da = a[(y + j) * w + x + i] - ma, db = b[(y + j) * w + x + i] - mb;
      va += da * da; vb += db * db; cov += da * db;
    }
    va /= N - 1; vb /= N - 1; cov /= N - 1;
    total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    count++;
  }
  return count ? total / count : 1;
}

export async function ssimSmall(smallPng, masterPng, size = 16) {
  const sharp = loadSharp();
  const a = await decode(smallPng);
  const down = await sharp(masterPng).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
  const b = await decode(down);
  return ssim(luma(a), luma(b), size, size);
}

const round = (v) => Math.round(v * 10000) / 10000;

// ---------- gate ----------

// All findings (pass included) and the raw numbers behind them.
export async function checkPackage(dir) {
  const metrics = {};
  const p = (rel) => join(dir, rel);
  const read = (rel) => readFileSync(p(rel), "utf8");
  const has = (rel) => existsSync(p(rel)) && statSync(p(rel)).size > 0;
  const findings = [];
  const manifest = has("manifest.json") ? JSON.parse(read("manifest.json")) : null;
  const skipped = new Set((manifest?.skipped ?? []).map((s) => s.path ?? s));

  const missing = PACKAGE_FILES.filter((f) => !has(f));
  metrics.files = { expected: PACKAGE_FILES.length, present: PACKAGE_FILES.length - missing.length };
  // A file the package declared skipped (no wordmark, no browser) is a warning; an undeclared absence fails.
  const hard = missing.filter((f) => !skipped.has(f));
  findings.push(finding("logo.files", hard.length ? "fail" : missing.length ? "warn" : "pass",
    hard.length ? `missing or empty: ${hard.join(", ")}` : missing.length ? `skipped by the package: ${missing.join(", ")}` : `${PACKAGE_FILES.length} files present`));

  if (!has("logo/mark.svg")) {
    findings.push(finding("logo.stroke-16", "skip", "logo/mark.svg missing"));
    return { findings, metrics };
  }
  const mark = read("logo/mark.svg");

  const st = await strokeSurvival(mark);
  metrics.stroke16 = { worstKept: round(st.worstKept), worstEroded: round(st.worst), components: st.components };
  findings.push(finding("logo.stroke-16", st.pass ? "pass" : "fail",
    `16 px (3× supersampled, alpha > 0.5), ${st.components} component(s): worst keeps ${(st.worstKept * 100).toFixed(0)}% under a 1 px opening (min 85%); ${(st.worst * 100).toFixed(0)}% survives 3×3 erosion`));

  const cc = await counterCheck(mark);
  metrics.counters32 = { counters: cc.counters, open: cc.open, minPx: cc.minSize };
  findings.push(finding("logo.counter-32", cc.pass ? "pass" : "fail",
    cc.counters
      ? `32 px: ${cc.open}/${cc.counters} counter(s) open, smallest ${cc.minSize} px across (min 2), ${cc.closed} closed up`
      : "no counters in the mark"));

  const bad = forbiddenTags(mark);
  findings.push(finding("logo.no-gradients", bad.length ? "fail" : "pass", bad.length ? `mark.svg contains <${bad.join(">, <")}>` : "paths only, no gradient/filter/mask/image/text"));

  const monoEvidence = [], monoBad = [];
  for (const f of ["logo/mark-mono-black.svg", "logo/mark-mono-white.svg"]) {
    if (!has(f)) { monoBad.push(`${f} missing`); continue; }
    const ps = paints(read(f));
    monoEvidence.push(`${f.split("/").pop()}: ${ps.join(", ") || "none"}`);
    if (ps.length !== 1) monoBad.push(`${f} has ${ps.length} paints`);
  }
  findings.push(finding("logo.mono-single-fill", monoBad.length ? "fail" : "pass", [...monoBad, ...monoEvidence].join("; ")));

  if (has("web/icon-maskable-512.png")) {
    const ms = await maskableSafe(readFileSync(p("web/icon-maskable-512.png")));
    metrics.maskable = { radiusRatio: ms.ratio };
    findings.push(finding("logo.maskable-safe", ms.pass ? "pass" : "fail",
      `content reaches r = ${ms.maxRadius}px (${(ms.ratio * 100).toFixed(1)}% of 512; limit 40%)`));
  } else findings.push(finding("logo.maskable-safe", "skip", "web/icon-maskable-512.png missing"));

  const co = await centroidOffset(mark);
  if (co) metrics.centroid = co;
  findings.push(co
    ? finding("logo.centroid", co.max > 0.04 ? "warn" : "pass",
      `centroid (${co.centroid.x}, ${co.centroid.y}) of canvas; offset from bbox centre x ${(co.bboxOffset.x * 100).toFixed(1)}%, y ${(co.bboxOffset.y * 100).toFixed(1)}% (warn > 4%)`)
    : finding("logo.centroid", "skip", "mark has no ink"));

  const small = has("raster/mark-16.png") ? readFileSync(p("raster/mark-16.png")) : await loadSharp()(Buffer.from(sizedSvg(mark, 16))).png().toBuffer();
  const master = has("raster/mark-1024.png") ? readFileSync(p("raster/mark-1024.png")) : await loadSharp()(Buffer.from(sizedSvg(mark, 1024))).png().toBuffer();
  const score = await ssimSmall(small, master, 16);
  metrics.ssim16 = round(score);
  findings.push(finding("logo.ssim-16", score < 0.6 ? "warn" : "pass", `SSIM(16 px raster, 1024 master ↓16) = ${score.toFixed(3)} (warn < 0.6)`));
  return { findings, metrics };
}

// Gate interface: ctx.plan.mark.outDir (relative to ctx.runDir) or ctx.dir. Pass findings
// are folded away by result(); the measured numbers stay in `metrics`.
export async function run(ctx = {}) {
  const raw = ctx.dir ?? ctx.plan?.mark?.outDir;
  if (!raw) return skip("logo-gate", "plan.mark.outDir not set");
  const dir = isAbsolute(raw) ? raw : resolve(ctx.runDir ?? process.cwd(), raw);
  if (!existsSync(dir)) return skip("logo-gate", `${dir} does not exist`);
  const { findings, metrics } = await checkPackage(dir);
  return result("logo-gate", findings, { dir, metrics });
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const usage = "usage: logo-gate.mjs --dir <package dir> | --run <runDir> (reads plan.mark.outDir) [--json]";
  let ctx;
  if (args.dir && args.dir !== true) ctx = { dir: String(args.dir) };
  else if (args.run && args.run !== true) {
    const runDir = resolve(String(args.run));
    ctx = { runDir, plan: JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) };
  } else fail(usage, 2);
  const r = await run(ctx);
  process.stdout.write((args.json ? JSON.stringify(r) : formatResult(r) + `\n  metrics ${JSON.stringify(r.metrics ?? {})}`) + "\n");
  process.exit(r.status === "fail" ? 1 : 0);
}
