#!/usr/bin/env node
// Template → one HyperFrames project per target.
//   node build.mjs --run <runDir> --template social/claim --params params.json --brand compositor/brand.json --targets ig-square,reels [--mode dark] [--json]
// Writes <runDir>/project/<target>/{index.html, hyperframes.json, gsap.min.js, fonts/, assets/}
// and merges the compositions into <runDir>/plan.json.
import { existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync, symlinkSync, rmSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs, fail, list } from "../lib/args.mjs";
import { readJson, writeJson, writeText, ensureDir } from "../lib/fs.mjs";
import { brandCss } from "../brand/theme.mjs";
import { target as targetOf, safeBox, TARGETS } from "../targets/presets.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const TEMPLATES_DIR = join(PLUGIN, "templates");

export function loadTemplate(name) {
  const dir = resolve(name.includes("/") && existsSync(name) ? name : join(TEMPLATES_DIR, name));
  const metaPath = join(dir, "template.json");
  const meta = existsSync(metaPath) ? readJson(metaPath) : null;
  // `html` lets sibling templates share one composition and differ only in template.json.
  const html = join(dir, meta?.html ?? "template.html");
  if (!meta || !existsSync(html)) fail(`template ${name} needs template.json and template.html (or template.json "html") in ${dir}`, 2);
  return { dir, name, html: readFileSync(html, "utf8"), meta };
}

export function listTemplates(mode) {
  const out = [];
  for (const m of readdirSync(TEMPLATES_DIR)) {
    if (m.startsWith("_") || (mode && m !== mode)) continue;
    const mdir = join(TEMPLATES_DIR, m);
    if (!lstatSync(mdir).isDirectory()) continue;
    for (const t of readdirSync(mdir)) {
      const meta = join(mdir, t, "template.json");
      if (existsSync(meta)) out.push({ id: `${m}/${t}`, ...readJson(meta) });
    }
  }
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

// {{path}} escaped, {{{path}}} raw, {{#path}}…{{/path}} / {{^path}}…{{/path}} blocks, {{path|default}}.
// Sections are filled first and parked behind sentinels, then every variable is
// replaced in one pass, so inserted text (raw JSON, SVG, copy with braces) is never rescanned.
export function fill(html, data) {
  // One store for the whole tree: a section's body can hold a placeholder parked by an earlier pass.
  const parked = [];
  const park = (text) => { parked.push(text); return `\u0000${parked.length - 1}\u0000`; };
  const render = (src) => {
    let out = src.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, p, body) => park(get(data, p) ? render(body) : ""));
    out = out.replace(/\{\{\^([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, p, body) => park(get(data, p) ? "" : render(body)));
    return out.replace(/\{\{\{([\w.]+)(?:\|([^}]*))?\}\}\}|\{\{([\w.]+)(?:\|([^}]*))?\}\}/g, (_, rawPath, rawDefault, escPath, escDefault) => {
      if (rawPath) { const v = get(data, rawPath); return park(v == null || v === "" ? (rawDefault ?? "") : String(v)); }
      const v = get(data, escPath);
      return park(escapeHtml(v == null || v === "" ? (escDefault ?? "") : String(v)));
    });
  };
  let out = render(html);
  while (/\u0000\d+\u0000/.test(out)) out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)]);
  return out;
}

// Validates params against template.json `params` ({ key: { type, required, default, maxWords, maxChars, enum } }).
export function checkParams(meta, params) {
  const errors = [];
  const out = { ...params };
  for (const [key, rule] of Object.entries(meta.params ?? {})) {
    let v = out[key];
    if ((v === undefined || v === "") && rule.default !== undefined) v = out[key] = rule.default;
    if ((v === undefined || v === "") && rule.required) { errors.push(`${key}: required`); continue; }
    if (v === undefined) continue;
    if (rule.enum && !rule.enum.includes(v)) errors.push(`${key}: expected one of ${rule.enum.join("|")}`);
    if (rule.maxWords && String(v).trim().split(/\s+/).length > rule.maxWords) errors.push(`${key}: more than ${rule.maxWords} words`);
    if (rule.maxChars && String(v).length > rule.maxChars) errors.push(`${key}: more than ${rule.maxChars} chars`);
    if (rule.type === "number" && Number.isNaN(Number(v))) errors.push(`${key}: not a number`);
  }
  return { params: out, errors };
}

function safeVars(name, t) {
  const box = safeBox(name, { width: t.width, height: t.height });
  return {
    "--w": `${t.width}px`, "--h": `${t.height}px`,
    "--safe-top": `${box.y}px`, "--safe-left": `${box.x}px`,
    "--safe-right": `${t.width - box.x - box.w}px`, "--safe-bottom": `${t.height - box.y - box.h}px`,
    "--safe-w": `${box.w}px`, "--safe-h": `${box.h}px`,
    "--aspect": (t.width / t.height).toFixed(4),
    "--orientation": t.width > t.height ? "landscape" : t.width < t.height ? "portrait" : "square",
  };
}

function linkOrCopy(src, dest) {
  if (!existsSync(src)) return;
  rmSync(dest, { recursive: true, force: true });
  try { symlinkSync(resolve(src), dest, "dir"); } catch { copyDir(src, dest); }
}
// Two sources with one basename must not overwrite each other: the second gets a path-hash prefix.
export function uniqueName(dir, src) {
  const name = basename(src);
  const dest = join(dir, name);
  if (!existsSync(dest)) return name;
  try { if (readFileSync(dest).equals(readFileSync(src))) return name; } catch {}
  return `${createHash("sha1").update(resolve(src)).digest("hex").slice(0, 8)}-${name}`;
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

export function buildProject({ runDir, template, params, brand, targets, mode, brandDir, fps, duration, assets }) {
  const tpl = typeof template === "string" ? loadTemplate(template) : template;
  const { params: p, errors } = checkParams(tpl.meta, params);
  if (errors.length) fail(`params for ${tpl.name}: ${errors.join("; ")}`, 2);
  const canvas = mode ?? tpl.meta.canvas ?? brand.color.video.canvasDefault;
  const css = brandCss(brand, { mode: canvas });
  const projectRoot = ensureDir(join(runDir, "project"));
  const shared = ensureDir(join(projectRoot, "_shared"));
  // Fonts: brand.json lists files relative to the product repo root (brandDir).
  const fontsDir = ensureDir(join(shared, "fonts"));
  for (const t of [brand.type.display, brand.type.body, brand.type.mono].filter(Boolean)) {
    for (const f of t.files ?? []) {
      const src = resolve(brandDir ?? ".", f);
      if (existsSync(src)) copyFileSync(src, join(fontsDir, basename(f)));
    }
  }
  ensureDir(join(shared, "assets"));
  for (const a of assets ?? []) if (existsSync(a)) (lstatSync(a).isDirectory() ? copyDir(a, join(shared, "assets", basename(a))) : copyFileSync(a, join(shared, "assets", uniqueName(join(shared, "assets"), a))));
  const gsapSrc = join(TEMPLATES_DIR, "_vendor", "gsap.min.js");
  const compositions = [];
  const wanted = targets?.length ? targets : tpl.meta.targets ?? [];
  // A template with `instances: "<key>"` builds one composition per item of params[key] (carousel slides);
  // the first item (the hook) also supplies plan.copy where the top-level params do not.
  const instanceKey = tpl.meta.instances ?? null;
  const items = instanceKey ? (p[instanceKey] ?? []).map((item, i) => ({ item, index: i + 1 })) : [{ item: null, index: 0 }];
  if (instanceKey && !items.length) fail(`template ${tpl.name} expects params.${instanceKey}[]`, 2);
  for (const name of wanted) for (const { item, index } of items) {
    const t = targetOf(name);
    if (!t.width) fail(`target ${name} has no fixed canvas; pick a sized target`, 2);
    const kind = tpl.meta.kind === "both" ? (t.kind === "still" ? "still" : "motion") : tpl.meta.kind === "page" ? "still" : tpl.meta.kind;
    if (kind === "motion" && t.kind === "still") continue;
    const dur = kind === "still" ? 1 / (fps ?? tpl.meta.fps ?? 30) : (duration ?? p.duration ?? tpl.meta.duration ?? 6);
    const f = fps ?? tpl.meta.fps ?? t.fps ?? 30;
    const compName = instanceKey ? `${name}-${String(index).padStart(2, "0")}` : name;
    const dir = ensureDir(join(projectRoot, compName));
    const vars = { ...safeVars(name, t), "--fps": String(f), "--duration": `${dur}s` };
    const scoped = instanceKey ? { ...p, ...item, slide: { ...item, index, count: items.length } } : p;
    const data = { ...scoped, copy: scoped, json: JSON.stringify(scoped).replace(/</g, "\\u003c"), brand: { name: brand.identity.name, tagline: brand.identity.tagline ?? "" }, target: { name, ...t, kind }, canvas, still: kind === "still", motion: kind === "motion", duration: dur, fps: f, logo: logoData(brand, brandDir, shared, canvas) };
    let html = fill(tpl.html, data);
    const head = `<link rel="compositor" data-target="${name}" data-template="${tpl.name}">\n<style id="compositor-brand">\n${css.replace(/url\("fonts\//g, 'url("fonts/')}\n:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n.safe { position: absolute; top: var(--safe-top); right: var(--safe-right); bottom: var(--safe-bottom); left: var(--safe-left); }\nhtml { --canvas: "${canvas}"; }\n</style>`;
    html = html.replace(/<\/head>/i, `${head}\n</head>`);
    html = html.replace(/<div([^>]*)id="root"([^>]*)>/, (m, a, b) => {
      let attrs = `${a}id="root"${b}`.replace(/\sdata-(width|height|duration|fps)="[^"]*"/g, "");
      return `<div${attrs} data-width="${t.width}" data-height="${t.height}" data-duration="${dur}" data-fps="${f}">`;
    });
    html = html.replace(/<html([^>]*)>/i, (m, a) => `<html${a.replace(/\sdata-target="[^"]*"/, "")} data-target="${name}" data-kind="${kind}">`);
    writeText(join(dir, "index.html"), html);
    // A template that stamps seams from params ships its motion-doctrine ledger beside the index.
    if (scoped.ledger?.seams) writeJson(join(dir, "ledger.json"), scoped.ledger);
    writeJson(join(dir, "hyperframes.json"), { paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: false } });
    copyFileSync(gsapSrc, join(dir, "gsap.min.js"));
    linkOrCopy(fontsDir, join(dir, "fonts"));
    linkOrCopy(join(shared, "assets"), join(dir, "assets"));
    compositions.push({ file: `project/${compName}/index.html`, dir: `project/${compName}`, name: compName, target: name, width: t.width, height: t.height, duration: dur, fps: f, kind, template: tpl.name, ...(instanceKey ? { slide: index, slides: items.length, page: tpl.meta.kind === "page" } : {}) });
  }
  if (!compositions.length) fail("no composition built: no target matched the template kind", 2);
  const planPath = join(runDir, "plan.json");
  const plan = readJson(planPath, {});
  const merged = { ...plan, template: tpl.name, canvas, targets: [...new Set([...(plan.targets ?? []), ...compositions.map((c) => c.target)])], compositions: [...(plan.compositions ?? []).filter((c) => !compositions.some((n) => (n.name ?? n.target) === (c.name ?? c.target))), ...compositions], copy: { ...(plan.copy ?? {}), ...pickCopy(instanceKey ? { ...(p[instanceKey]?.[0] ?? {}), ...p } : p) }, params: p, ...(p.audio && typeof p.audio === "object" ? { audio: { ...(plan.audio ?? {}), ...p.audio } } : {}) };
  writeJson(planPath, merged);
  return { compositions, plan: merged, canvas };
}

function pickCopy(p) {
  const out = {};
  for (const k of ["headline", "body", "cta", "legal", "kicker", "claim", "subline"]) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

// A themed SVG switches on prefers-color-scheme, which follows the renderer, not the canvas. Settle it
// for the canvas: on a dark canvas the dark rules are unwrapped after the base rules so they win; on a
// light canvas they are dropped.
export function svgForCanvas(svg, canvas) {
  const head = /@media\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*\{/gi;
  let out = "", from = 0, m;
  const keep = [];
  while ((m = head.exec(svg))) {
    let depth = 1, i = head.lastIndex;
    for (; i < svg.length && depth; i++) depth += svg[i] === "{" ? 1 : svg[i] === "}" ? -1 : 0;
    out += svg.slice(from, m.index);
    if (m[1].toLowerCase() === canvas) keep.push(svg.slice(head.lastIndex, i - 1));
    from = head.lastIndex = i;
  }
  out += svg.slice(from);
  if (!keep.length) return out;
  return out.replace(/<\/style>/i, `${keep.join("")}</style>`);
}

const inlineSvg = (path, canvas) => svgForCanvas(readFileSync(path, "utf8").replace(/<\?xml[^>]*>/, "").replace(/<!DOCTYPE[^>]*>/i, ""), canvas);

// `monoSvg`: the brand's single-colour mark for this canvas (logo.mono.dark on a dark canvas), when it ships one.
function logoData(brand, brandDir, shared, canvas) {
  const out = {};
  const mono = brand.identity.logo?.mono?.[canvas];
  const monoSrc = mono && resolve(brandDir ?? ".", mono);
  if (monoSrc && /\.svg$/i.test(monoSrc) && existsSync(monoSrc)) out.monoSvg = inlineSvg(monoSrc, canvas);
  for (const k of ["mark", "wordmark", "lockup"]) {
    const rel = brand.identity.logo?.[k];
    if (!rel) continue;
    const src = resolve(brandDir ?? ".", rel);
    if (!existsSync(src)) continue;
    const dest = join(shared, "assets", `logo-${k}${src.match(/\.\w+$/)?.[0] ?? ".svg"}`);
    copyFileSync(src, dest);
    out[k] = `assets/${basename(dest)}`;
    if (/\.svg$/i.test(src)) out[`${k}Svg`] = inlineSvg(src, canvas);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) { for (const t of listTemplates(args.mode)) process.stdout.write(`${t.id}\t${t.kind}\t${t.description ?? ""}\n`); process.exit(0); }
  if (!args.run || !args.template) fail("usage: build.mjs --run <runDir> --template <mode/name> [--params p.json] [--brand brand.json] [--targets a,b] [--mode light|dark] [--assets dir,file] [--duration s]", 2);
  const runDir = resolve(args.run);
  const brandPath = resolve(args.brand ?? join(runDir, "../../brand.json"));
  const brand = readJson(brandPath);
  const params = args.params ? readJson(resolve(args.params)) : readJson(join(runDir, "params.json"), {});
  const r = buildProject({ runDir, template: args.template, params, brand, targets: list(args.targets), mode: args.mode, brandDir: resolve(dirname(brandPath), ".."), fps: args.fps && Number(args.fps), duration: args.duration && Number(args.duration), assets: list(args.assets).map((a) => resolve(a)) });
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2));
  else for (const c of r.compositions) process.stdout.write(`${c.target}\t${c.width}x${c.height}\t${c.kind}\t${c.duration}s @${c.fps}\t${c.file}\n`);
}
