// Logo discovery and classification by aspect ratio and fill.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { loadSharp } from "../../lib/browser.mjs";

const CANDIDATE_DIRS = ["public", "public/brand", "public/images", "public/img", "brand", "assets", "assets/brand", "src/assets", "src/assets/brand", "app", "src/app", "static"];
const NAME = /(logo|mark|wordmark|lockup|brand|icon|favicon|apple-icon|og)/i;
const EXT = /\.(svg|png|webp|jpg|jpeg|ico)$/i;
const WORKSPACE_DIRS = ["apps", "packages"];

// Root first, so a root-level logo keeps the slot over one inside a workspace package.
function workspaceBases(root) {
  const bases = [root];
  for (const ws of WORKSPACE_DIRS) {
    const full = join(root, ws);
    if (!existsSync(full)) continue;
    try {
      for (const name of readdirSync(full).sort()) {
        const p = join(full, name);
        if (statSync(p).isDirectory()) bases.push(p);
      }
    } catch {}
  }
  return bases;
}

export function findLogoFiles(root) {
  const hits = [];
  for (const base of workspaceBases(root)) for (const dir of CANDIDATE_DIRS) {
    const full = join(base, dir);
    if (!existsSync(full)) continue;
    let entries;
    try { entries = readdirSync(full); } catch { continue; }
    for (const name of entries) {
      const p = join(full, name);
      if (!EXT.test(name) || !NAME.test(name)) continue;
      try { if (statSync(p).isFile()) hits.push(p); } catch {}
    }
  }
  return [...new Set(hits)];
}

async function dims(path) {
  if (/\.svg$/i.test(path)) {
    const svg = readFileSync(path, "utf8");
    const vb = svg.match(/viewBox=["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (vb) return { width: Number(vb[1]), height: Number(vb[2]), svg };
    const w = Number(svg.match(/\swidth=["']([\d.]+)/)?.[1]), h = Number(svg.match(/\sheight=["']([\d.]+)/)?.[1]);
    return { width: w || 1, height: h || 1, svg };
  }
  try {
    const sharp = loadSharp();
    const m = await sharp(path).metadata();
    return { width: m.width, height: m.height };
  } catch {
    return { width: 1, height: 1 };
  }
}

function monoOf(svg) {
  if (!svg) return null;
  const fills = new Set([...svg.matchAll(/(?:fill|stroke)\s*[:=]\s*["']?(#[0-9a-f]{3,8}|black|white|currentColor)/gi)].map((m) => m[1].toLowerCase()));
  if (!fills.size) return null;
  const all = [...fills];
  if (all.every((f) => /^(#000|#000000|black)$/.test(f))) return "light";
  if (all.every((f) => /^(#fff|#ffffff|white)$/.test(f))) return "dark";
  if (all.every((f) => f === "currentcolor")) return "current";
  return null;
}

export async function classifyLogos(files) {
  const out = { mark: null, wordmark: null, lockup: null, mono: {}, favicon: null, icon: null, appleIcon: null, og: null, all: [] };
  for (const path of files) {
    const name = basename(path).toLowerCase();
    const d = await dims(path);
    const ratio = d.width / d.height;
    const mono = monoOf(d.svg);
    const entry = { path, width: d.width, height: d.height, ratio: Number(ratio.toFixed(2)), mono, ext: extname(path).slice(1) };
    out.all.push(entry);
    if (/^favicon/.test(name)) { out.favicon ||= entry; continue; }
    // A browser icon (Next app/icon, a public icon.svg) is drawn for tab size; a real logo outranks it.
    if (/^icon\./.test(name)) { if (!out.icon || (entry.ext === "svg" && out.icon.ext !== "svg")) out.icon = entry; continue; }
    if (/apple-icon|apple-touch/.test(name)) { out.appleIcon ||= entry; continue; }
    if (/^og/.test(name)) { out.og ||= entry; continue; }
    const svgFirst = (slot) => !out[slot] || (entry.ext === "svg" && out[slot].ext !== "svg");
    if (/wordmark/.test(name) || ratio > 2.5) { if (svgFirst("wordmark")) out.wordmark = entry; }
    else if (/lockup/.test(name) || (ratio > 1.3 && ratio <= 2.5)) { if (svgFirst("lockup")) out.lockup = entry; }
    else if (mono && /mono|black|white/.test(name)) { out.mono[mono] ||= entry; }
    else if (svgFirst("mark")) out.mark = entry;
  }
  if (!out.mark && out.icon) out.mark = { ...out.icon, confidence: "low" };
  if (!out.mark && out.appleIcon) out.mark = { ...out.appleIcon, confidence: "low" };
  if (!out.mark && out.favicon) out.mark = { ...out.favicon, confidence: "low" };
  return out;
}
