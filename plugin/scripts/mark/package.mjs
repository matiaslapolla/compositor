// Logo package: spec + brand → logo/, raster/, web/, social/, brand-sheet.png, manifest.json
// (docs/research/parametric-logos.md §Logo package). Chromium renders only the OG card
// and the brand sheet; everything else is sharp.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, extname, relative } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, writeText, ensureDir, walk } from "../lib/fs.mjs";
import { loadSharp } from "../lib/browser.mjs";
import { el } from "../lib/svg.mjs";
import { buildMark, monoVariant, constructionVariant, wordmark, lockup, readSvgPaths, rolesOf, resolveFill } from "./compose.mjs";
import { flattenPath, transformD } from "./geom.mjs";
import { sheetHtml, ogHtml, renderHtml, dataUri } from "./sheet.mjs";
import { sizedSvg } from "../gates/logo-gate.mjs";

const RASTER = [16, 32, 64, 128, 256, 512, 1024];
const WEBP = [256, 512, 1024];

// Re-frames the 1000-unit mark into a square `size` canvas, scaling about the canvas
// centre so the optical centring survives. fit "box": content within ratio × size;
// fit "radius": every point within ratio × size of the centre.
export function framedSvg(markText, { size, ratio, fit = "box", bg }) {
  const paths = readSvgPaths(markText);
  const pts = paths.flatMap((a) => flattenPath(a.d, 1).flatMap((r) => r.points));
  const reach = fit === "radius"
    ? Math.max(...pts.map(([x, y]) => Math.hypot(x - 500, y - 500)))
    : Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x - 500), Math.abs(y - 500))));
  const target = fit === "radius" ? ratio * size : (ratio * size) / 2;
  const s = target / (reach || 1);
  const t = { s, tx: size / 2 - 500 * s, ty: size / 2 - 500 * s };
  const body = paths.map((a) => el("path", { d: transformD(a.d, t), fill: a.fill, "fill-rule": a["fill-rule"] }));
  if (bg) body.unshift(el("rect", { width: size, height: size, fill: bg }));
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${size} ${size}`, width: size, height: size }, "\n" + body.join("\n") + "\n") + "\n";
}

export function faviconSvg(markText, { light, dark }) {
  const framed = framedSvg(markText, { size: 1000, ratio: 1 });
  const stripped = framed.replace(/\sfill="[^"]*"/g, "");
  const style = `<style>path{fill:${light}}@media (prefers-color-scheme:dark){path{fill:${dark}}}</style>`;
  return stripped.replace(/(<svg\b[^>]*>)/, `$1\n${style}`);
}

// ICO container with PNG payloads (Vista+ format): ICONDIR + ICONDIRENTRY × n + data.
export function packIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

const png = (svgText, size) => loadSharp()(Buffer.from(sizedSvg(svgText, size))).png({ compressionLevel: 9 }).toBuffer();

// Display font for the wordmark: --font, else a readable file listed in brand.type.display.
export function resolveFont(explicit, brand, brandPath) {
  if (explicit) return resolve(String(explicit));
  const files = [...(brand?.type?.display?.files ?? []), ...(brand?.type?.body?.files ?? [])];
  const bases = brandPath ? [dirname(brandPath), dirname(dirname(brandPath)), process.cwd()] : [process.cwd()];
  for (const f of files) {
    if (![".ttf", ".otf", ".woff"].includes(extname(f).toLowerCase())) continue;
    for (const b of bases) if (existsSync(resolve(b, f))) return resolve(b, f);
  }
  return null;
}

export async function buildPackage({ spec, brand, out, wordmarkText, fontFile, browser = true, brandPath }) {
  const sharp = loadSharp();
  ensureDir(out);
  const light = rolesOf(brand, "light"), dark = rolesOf(brand, "dark");
  const name = brand?.identity?.name ?? wordmarkText ?? "Mark";
  const { svg: mark, meta } = buildMark({ ...spec, colors: { mode: "light", ...(spec.colors ?? {}) } }, brand);
  const skipped = [];
  const w = (rel, data) => writeText(join(out, rel), data);

  // logo/
  const monoBlack = monoVariant(mark, "#000000"), monoWhite = monoVariant(mark, "#ffffff");
  const fillsAccent = meta.fills.includes("role:accent");
  const construction = constructionVariant(mark, meta, { color: fillsAccent ? light.fg : light.accent });
  w("logo/mark.svg", mark);
  w("logo/mark-mono-black.svg", monoBlack);
  w("logo/mark-mono-white.svg", monoWhite);
  w("logo/mark-construction.svg", construction);
  let lockH = null, lockS = null;
  const text = wordmarkText ?? brand?.identity?.name;
  if (text && fontFile) {
    const word = wordmark(text, fontFile, { size: 200, tracking: spec.wordmark?.tracking ?? 0, fill: light.fg });
    lockH = lockup(mark, word, { layout: "horizontal", ...(spec.lockup?.horizontal ?? {}) });
    lockS = lockup(mark, word, { layout: "stacked", ...(spec.lockup?.stacked ?? {}) });
    w("logo/wordmark.svg", word);
    w("logo/lockup-horizontal.svg", lockH);
    w("logo/lockup-stacked.svg", lockS);
  } else {
    for (const f of ["logo/wordmark.svg", "logo/lockup-horizontal.svg", "logo/lockup-stacked.svg"]) skipped.push({ path: f, reason: "no wordmark text or font" });
  }

  // raster/
  for (const s of RASTER) w(`raster/mark-${s}.png`, await png(mark, s));
  for (const s of WEBP) w(`raster/mark-${s}.webp`, await sharp(Buffer.from(sizedSvg(mark, s))).webp({ lossless: true }).toBuffer());

  // web/
  const tight = framedSvg(mark, { size: 1000, ratio: 1 });
  w("web/favicon.ico", packIco(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await png(tight, size) })))));
  w("web/favicon.svg", faviconSvg(mark, { light: light.fg, dark: dark.fg }));
  const opaque = (size, ratio, fit = "box") => png(framedSvg(mark, { size, ratio, fit, bg: light.bg }), size);
  w("web/apple-touch-icon.png", await opaque(180, 0.8));
  w("web/icon-192.png", await opaque(192, 0.8));
  w("web/icon-512.png", await opaque(512, 0.8));
  w("web/icon-maskable-512.png", await opaque(512, 0.4 * 0.95, "radius"));
  w("web/manifest.webmanifest", JSON.stringify({
    name, short_name: name, display: "standalone", background_color: light.bg, theme_color: light.accent,
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  }, null, 2) + "\n");

  // social/
  w("social/avatar-400.png", await opaque(400, 0.6));
  const jobs = [];
  if (browser) {
    if (lockH) jobs.push({ html: ogHtml({ lockupSvg: lockup(mark, readFileSync(join(out, "logo/wordmark.svg"), "utf8"), { layout: "horizontal", clearSpace: 0, ...(spec.lockup?.horizontal ?? {}) }), roles: { light, dark }, tagline: brand?.identity?.tagline, fontFile }), out: join(out, "social/og-1200x630.png"), width: 1200, height: 630 });
    else skipped.push({ path: "social/og-1200x630.png", reason: "no lockup (no wordmark)" });
    const darkMark = buildMark({ ...spec, colors: { mode: "dark" } }, brand).svg;
    const minSizes = await Promise.all([16, 24, 32, 48].map(async (px) => ({ px, png: dataUri(await png(tight, px), "image/png") })));
    const minSizesDark = await Promise.all([16, 24, 32, 48].map(async (px) => ({ px, png: dataUri(await png(framedSvg(darkMark, { size: 1000, ratio: 1 }), px), "image/png") })));
    const chips = [
      ...meta.fills.filter((f) => f !== "none").map((f) => ({ name: f.replace(/^role:/, ""), hex: resolveFill(f, light) })),
      { name: "fg", hex: light.fg }, { name: "bg", hex: light.bg }, { name: "dark bg", hex: dark.bg },
    ].filter((c, i, a) => a.findIndex((x) => x.hex === c.hex) === i).slice(0, 6);
    jobs.push({
      html: sheetHtml({
        name, tagline: brand?.identity?.tagline, generator: spec.generator, divisions: meta.grid?.divisions ?? 24,
        markSvg: mark, constructionSvg: construction, lockupSvg: lockH ?? mark, monoBlackSvg: monoBlack, monoWhiteSvg: monoWhite,
        roles: { light, dark }, chips, minSizes, minSizesDark, clearSpace: spec.clearSpace ?? 1, fontFile,
      }),
      out: join(out, "brand-sheet.png"), width: 1600, height: 2000,
    });
    await renderHtml(jobs);
  } else {
    skipped.push({ path: "social/og-1200x630.png", reason: "--no-browser" }, { path: "brand-sheet.png", reason: "--no-browser" });
  }

  const files = walk(out, (rel) => rel !== "manifest.json", { maxDepth: 3 })
    .map((f) => ({ path: relative(out, f), bytes: statSync(f).size }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    name, generator: spec.generator, seed: spec.seed ?? 1, spec,
    mark: { centroid: meta.centroid, bbox: meta.bbox, transform: meta.transform, fills: meta.fills, overshoot: meta.overshoot },
    files, skipped,
  };
  writeJson(join(out, "manifest.json"), manifest);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const usage = "usage: package.mjs --spec spec.json --brand compositor/brand.json --out <dir> [--wordmark \"Name\" --font <file.ttf|otf|woff>] [--no-wordmark] [--no-browser] [--json]";
  if (!args.spec || args.spec === true || !args.out || args.out === true) fail(usage, 2);
  let spec, brand = null;
  try {
    spec = readJson(String(args.spec));
    if (args.brand && args.brand !== true) brand = readJson(String(args.brand));
  } catch (e) {
    fail(e.message, 2);
  }
  const wantWord = args.wordmark !== false;
  const text = typeof args.wordmark === "string" ? args.wordmark : brand?.identity?.name;
  const font = wantWord ? resolveFont(args.font && args.font !== true ? args.font : null, brand, args.brand && resolve(String(args.brand))) : null;
  if (wantWord && text && !font) fail(`no usable font for the wordmark "${text}": pass --font <file.ttf|.otf|.woff> or --no-wordmark`, 2);
  if (font && !existsSync(font)) fail(`font file not found: ${font}`, 2);
  let manifest;
  try {
    manifest = await buildPackage({
      spec, brand, out: resolve(String(args.out)), wordmarkText: wantWord ? text : null, fontFile: font, browser: args.browser !== false,
      brandPath: args.brand && resolve(String(args.brand)),
    });
  } catch (e) {
    const usageError = /^(mark|wordmark|lockup|monogram|fourier|boolean):/.test(e.message);
    fail(e.message + (/Chromium|browser/i.test(e.message) ? " (use --no-browser to skip the OG card and brand sheet)" : ""), usageError ? 2 : 1);
  }
  if (args.json) process.stdout.write(JSON.stringify(manifest) + "\n");
  else {
    const total = manifest.files.reduce((a, f) => a + f.bytes, 0);
    process.stdout.write(`${manifest.name}: ${manifest.files.length} files, ${(total / 1024).toFixed(0)} KiB → ${args.out}\n`);
    for (const s of manifest.skipped) process.stdout.write(`  skipped ${s.path} (${s.reason})\n`);
  }
}
