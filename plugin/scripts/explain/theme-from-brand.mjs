#!/usr/bin/env node
// brand.json → theme.json for the Manim engine, plus the brand's fonts for fontconfig.
//   node theme-from-brand.mjs --brand compositor/brand.json --out <run>/theme.json [--mode dark|light] [--json]
// Writes beside theme.json: fonts/ (copies of the brand font files) and fonts.conf
// (system config + that dir). run.sh exports FONTCONFIG_FILE when fonts.conf sits next to --theme.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, writeText, ensureDir } from "../lib/fs.mjs";
import { manimTheme } from "../brand/theme.mjs";

// brand font paths are relative to the product repo root (the parent of compositor/).
function locateFont(file, brandPath, roots) {
  if (isAbsolute(file)) return existsSync(file) ? file : null;
  const brandDir = dirname(resolve(brandPath));
  for (const base of [...roots, brandDir, dirname(brandDir), process.cwd()]) {
    const candidate = join(base, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// fontconfig cannot read woff2 (Google Fonts ships only that); convert to TTF with woff2_decompress or, failing that, fonttools through uvx.
function woff2ToTtf(woff2) {
  const attempts = [
    ["woff2_decompress", [woff2]],
    ["uvx", ["--from", "fonttools[woff]", "fonttools", "ttLib.woff2", "decompress", woff2]],
  ];
  for (const [bin, argv] of attempts) {
    const r = spawnSync(bin, argv, { encoding: "utf8" });
    const ttf = woff2.replace(/\.woff2$/, ".ttf");
    if (r.status === 0 && existsSync(ttf)) {
      rmSync(woff2);
      return ttf;
    }
  }
  rmSync(woff2, { force: true });
  return null;
}

export function fontsConf(fontsDir) {
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${fontsDir}</dir>
</fontconfig>
`;
}

export function buildTheme(brandPath, outPath, { mode, fontRoots = [] } = {}) {
  const theme = manimTheme(readJson(brandPath), { mode });
  const outDir = dirname(resolve(outPath));
  const fontsDir = join(outDir, "fonts");
  const copied = [];
  const missing = [];
  for (const file of [...new Set(theme.fontFiles)]) {
    const found = locateFont(file, brandPath, fontRoots);
    if (!found) {
      missing.push(file);
      continue;
    }
    ensureDir(fontsDir);
    const dest = join(fontsDir, basename(found));
    copyFileSync(found, dest);
    const usable = /\.woff2$/i.test(dest) ? woff2ToTtf(dest) : dest;
    if (usable) copied.push(usable);
    else missing.push(`${file} (woff2 conversion failed: install the woff2 package or uv)`);
  }
  writeJson(outPath, { ...theme, fontFiles: copied });
  if (copied.length) writeText(join(outDir, "fonts.conf"), fontsConf(fontsDir));
  return { theme: { ...theme, fontFiles: copied }, out: resolve(outPath), copied, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brand || !args.out || args.brand === true || args.out === true) fail("usage: theme-from-brand.mjs --brand brand.json --out theme.json [--mode dark|light] [--json]", 2);
  let result;
  try {
    result = buildTheme(args.brand, args.out, { mode: args.mode === true ? undefined : args.mode });
  } catch (e) {
    fail(e.message, 2);
  }
  if (args.json) process.stdout.write(JSON.stringify({ out: result.out, BG: result.theme.BG, fonts: result.copied.length, missingFonts: result.missing }) + "\n");
  else {
    process.stdout.write(`theme: ${result.out} (BG ${result.theme.BG}, font ${result.theme.FONT}, ${result.copied.length} font files)\n`);
    if (result.missing.length) process.stderr.write(`warning: ${result.missing.length} brand font files not found, Manim falls back to a system font for ${result.theme.FONT}\n`);
  }
}
