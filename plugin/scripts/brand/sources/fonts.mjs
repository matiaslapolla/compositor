// Font discovery: next/font (google + local), @font-face blocks, CSS font
// variables; then materialization of each family to local woff2 files so
// HyperFrames never fetches at build time.
import { readFileSync, existsSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { walk } from "../../lib/fs.mjs";

// Families the HyperFrames compiler bundles (hyperframes-creative/references/typography.md, 0.8.x).
export const HYPERFRAMES_BUNDLED = new Set(["Inter", "Roboto", "Montserrat", "Oswald", "League Gothic", "Archivo Black", "Playfair Display", "EB Garamond", "Space Mono", "IBM Plex Mono", "JetBrains Mono", "Source Code Pro", "Noto Sans JP"]);

const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace", "ui-monospace", "ui-sans-serif", "ui-serif", "-apple-system", "blinkmacsystemfont", "segoe ui", "arial", "helvetica", "georgia", "times new roman", "menlo", "consolas", "monaco", "cursive", "fantasy", "inherit"]);

// Every non-generic family in a font stack, in order.
export function realFamilies(stack) {
  const out = [];
  for (const part of String(stack ?? "").split(",")) {
    const fam = part.trim().replace(/^['"]|['"]$/g, "");
    if (!fam || fam.startsWith("var(") || GENERIC.has(fam.toLowerCase())) continue;
    out.push(fam);
  }
  return out;
}

// The first family that carries text. A face whose unicode-range covers only a
// few code points (digit subsets like "Orbit Figures") is skipped.
export function firstRealFamily(stack, faces = new Map()) {
  for (const fam of realFamilies(stack)) {
    const face = faces.get(fam);
    if (face && face.narrow) continue;
    return fam;
  }
  return null;
}

function rangeSize(range) {
  if (!range) return Infinity;
  let n = 0;
  for (const part of range.split(",")) {
    const m = part.trim().match(/U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i);
    if (!m) continue;
    if (m[1].includes("?")) { n += 16 ** (m[1].match(/\?/g).length); continue; }
    n += m[2] ? parseInt(m[2], 16) - parseInt(m[1], 16) + 1 : 1;
  }
  return n;
}

export function findLayoutFiles(root) {
  return walk(root, (rel, name) => /^(layout|fonts?|_app|root-layout)\.(tsx|ts|jsx|js|astro)$/.test(name) || /(^|\/)(fonts?)\.(ts|js)$/.test(rel), { maxDepth: 6 });
}

// next/font/google: `import { Archivo, Chivo_Mono } from "next/font/google"` then
// `const x = Archivo({ variable: '--font-archivo', weight: [...] })`.
export function readNextFonts(files) {
  const out = [];
  for (const file of files) {
    let src;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    const googleImport = src.match(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/);
    const names = googleImport ? googleImport[1].split(",").map((s) => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) : [];
    for (const id of names) {
      const call = src.match(new RegExp(`${id}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`));
      const opts = call ? call[1] : "";
      const variable = opts.match(/variable\s*:\s*["'](--[\w-]+)["']/)?.[1] ?? null;
      const weight = [...opts.matchAll(/["'](\d{3}(?:\s+\d{3})?|variable)["']/g)].map((m) => m[1]).filter((w) => /^\d/.test(w));
      out.push({ kind: "google", family: id.replace(/_/g, " "), variable, weights: weight.length ? weight : null, file });
    }
    if (/next\/font\/local/.test(src)) {
      for (const m of src.matchAll(/localFont\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        const opts = m[1];
        const variable = opts.match(/variable\s*:\s*["'](--[\w-]+)["']/)?.[1] ?? null;
        const srcs = [...opts.matchAll(/path\s*:\s*["']([^"']+)["']|src\s*:\s*["']([^"']+)["']/g)].map((x) => resolve(dirname(file), x[1] || x[2]));
        const family = variable ? variable.replace(/^--font-/, "").replace(/-/g, " ") : basename(srcs[0] || "local", ".woff2");
        out.push({ kind: "local", family, variable, files: srcs.filter(existsSync), file });
      }
    }
  }
  return out;
}

// @font-face blocks across CSS files → family → local files.
export function readFontFaces(cssFiles) {
  const faces = new Map();
  for (const file of cssFiles) {
    let css;
    try { css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""); } catch { continue; }
    for (const m of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
      const block = m[1];
      const family = block.match(/font-family\s*:\s*["']?([^;"']+)["']?/)?.[1]?.trim();
      if (!family) continue;
      const urls = [...block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1]).filter((u) => !/^(https?:|data:)/.test(u));
      const weight = block.match(/font-weight\s*:\s*([^;]+)/)?.[1]?.trim() ?? "400";
      const range = block.match(/unicode-range\s*:\s*([^;]+)/)?.[1]?.trim() ?? null;
      const files = urls.map((u) => resolve(dirname(file), u)).filter(existsSync);
      const entry = faces.get(family) ?? { family, files: [], weights: [], ranges: [], file, narrow: true };
      entry.files.push(...files);
      entry.weights.push(weight);
      entry.ranges.push(range);
      if (rangeSize(range) > 200) entry.narrow = false;
      faces.set(family, entry);
    }
  }
  return faces;
}

// Resolves the role variables (--font-sans/--font-heading/--font-mono/...) to
// families, through next/font variables when the value is var(--font-x).
export function fontRoles(lookup, nextFonts, faces = new Map()) {
  const byVariable = new Map(nextFonts.filter((f) => f.variable).map((f) => [f.variable, f]));
  const roleVars = {
    display: ["font-display", "font-heading", "font-headline", "font-title", "font-serif"],
    body: ["font-body", "font-sans", "font-text", "font-base"],
    mono: ["font-mono", "font-code"],
  };
  const out = {};
  for (const [role, keys] of Object.entries(roleVars)) {
    for (const key of keys) {
      const entry = lookup(key);
      if (!entry) continue;
      const raw = entry.raw ?? entry.value;
      const viaVar = raw.match(/var\(\s*(--font-[\w-]+)/)?.[1];
      const nf = viaVar && byVariable.get(viaVar);
      const family = nf?.family ?? firstRealFamily(entry.value, faces);
      if (!family) continue;
      out[role] = { family, stack: realFamilies(entry.value), source: nf ? { kind: nf.kind } : { kind: "css" }, nextFont: nf ?? null, provenance: { ...entry, name: key } };
      break;
    }
  }
  return out;
}

// Google Fonts → woff2 files in `dir`. Returns { files, css } or { error }.
export async function materializeGoogle(family, weights, dir, { fetchImpl = globalThis.fetch } = {}) {
  const wght = weights?.length ? weights.map((w) => (w.includes(" ") ? w.replace(" ", "..") : w)).sort().join(";") : "400;700";
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${wght}&display=block`;
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `google fonts ${res.status}` };
    const css = await res.text();
    mkdirSync(dir, { recursive: true });
    const files = [];
    let out = "";
    for (const m of css.matchAll(/\/\*\s*(\w[\w-]*)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)) {
      const subset = m[1];
      if (!/^latin/.test(subset)) continue;
      const block = m[2];
      const src = block.match(/url\(([^)]+)\)/)?.[1];
      const weight = block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() ?? "400";
      const style = block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() ?? "normal";
      if (!src) continue;
      const name = `${family.replace(/\s+/g, "")}-${weight.replace(/\s+/g, "_")}-${style}-${subset}.woff2`;
      const path = join(dir, name);
      if (!existsSync(path)) {
        const bin = await fetchImpl(src, { signal: AbortSignal.timeout(20000) });
        if (!bin.ok) continue;
        writeFileSync(path, Buffer.from(await bin.arrayBuffer()));
      }
      files.push(path);
      out += block.replace(/src:[^;]+;/, `src: url("fonts/${name}") format("woff2");`).replace(/\n\s*/g, " ").trim();
      out = `@font-face {${out.split("@font-face {").at(-1)}}\n`;
    }
    const faceCss = [...css.matchAll(/\/\*\s*(latin[\w-]*)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g)].map(([, subset, block]) => {
      const weight = block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() ?? "400";
      const style = block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() ?? "normal";
      const name = `${family.replace(/\s+/g, "")}-${weight.replace(/\s+/g, "_")}-${style}-${subset}.woff2`;
      return `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; font-display: block; src: url("fonts/${name}") format("woff2"); ${block.match(/unicode-range:[^;]+;/)?.[0] ?? ""} }`;
    });
    return { files, css: faceCss.join("\n") };
  } catch (e) {
    return { error: e.message };
  }
}

// Google-style subset names carry their range; without it two subsets of one
// family override each other and the last declared wins.
const SUBSET_RANGES = {
  "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
};
export function rangeFromName(name) {
  const n = name.toLowerCase();
  if (/latin-?ext/.test(n)) return SUBSET_RANGES["latin-ext"];
  if (/(^|[-_.])latin([-_.]|$)/.test(n)) return SUBSET_RANGES.latin;
  return null;
}

export function materializeLocal(family, srcFiles, dir, weights = [], ranges = []) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  const css = [];
  srcFiles.forEach((src, i) => {
    const name = basename(src);
    const dest = join(dir, name);
    if (!existsSync(dest)) copyFileSync(src, dest);
    files.push(dest);
    const weight = weights[i] ?? "100 900";
    const fmt = /woff2/.test(name) ? (/variations|wght|\[/.test(name) ? "woff2-variations" : "woff2") : /woff$/.test(name) ? "woff" : /otf$/.test(name) ? "opentype" : "truetype";
    const inferred = ranges[i] ?? rangeFromName(name);
    const range = inferred ? ` unicode-range: ${inferred};` : "";
    css.push(`@font-face { font-family: "${family}"; font-weight: ${weight}; font-display: block; src: url("fonts/${name}") format("${fmt}");${range} }`);
  });
  return { files, css: css.join("\n") };
}
