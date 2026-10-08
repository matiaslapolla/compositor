// Shared plumbing for gate modules: findings, status folding, hints from
// references/gates.md, target normalization and the CLI wrapper.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson } from "../lib/fs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HINTS_PATH = join(here, "../../references/gates.md");
const RANK = { skip: 0, pass: 1, warn: 2, fail: 3 };

let hints;
// `### rule.id` headings; the first non-empty line after the heading is the hint.
// A heading ending in `*` (e.g. `hf:*`) is a prefix fallback.
export function hint(rule) {
  if (!hints) {
    hints = new Map();
    const text = existsSync(HINTS_PATH) ? readFileSync(HINTS_PATH, "utf8") : "";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^###\s+`?([^`\s]+)`?\s*$/);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && !lines[j].startsWith("#")) hints.set(m[1], lines[j].trim());
    }
  }
  if (hints.has(rule)) return hints.get(rule);
  for (const [k, v] of hints) if (k.endsWith("*") && rule.startsWith(k.slice(0, -1))) return v;
  return "";
}

export const finding = (rule, status, evidence, extraHint) => ({ rule, status, evidence, hint: extraHint || hint(rule) });

export function worst(statuses) {
  let out = "pass";
  for (const s of statuses) if (RANK[s] > RANK[out]) out = s;
  return out;
}

// Pass findings are dropped: the result lists only what needs attention.
export function result(gate, findings, extra = {}) {
  const kept = findings.filter((f) => f.status !== "pass");
  const measured = findings.filter((f) => f.status !== "skip");
  const status = measured.length || !findings.length ? worst(kept.map((f) => f.status)) : "skip";
  const out = { gate, status, findings: kept, ...extra };
  if (status === "skip" && !out.reason) out.reason = kept.map((f) => f.evidence?.reason).filter(Boolean).join("; ") || "nothing measurable";
  return out;
}

export const skip = (gate, reason) => ({ gate, status: "skip", reason, findings: [] });

// Safe insets as fractions { top, right, bottom, left } from any preset shape:
// a `safe: [t, r, b, l]` array, an inset object, or a box `{ x0, y0, x1, y1 }`.
export function insets(target) {
  const s = target?.safeBox ?? target?.safe;
  if (!s) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (Array.isArray(s)) {
    const [top, right = top, bottom = top, left = right] = s;
    return { top, right, bottom, left };
  }
  if ("x0" in s || "y0" in s) return { top: s.y0 ?? 0, right: 1 - (s.x1 ?? 1), bottom: 1 - (s.y1 ?? 1), left: s.x0 ?? 0 };
  if ("x" in s && "w" in s && target.width && target.height) {
    return { top: s.y / target.height, left: s.x / target.width, right: 1 - (s.x + s.w) / target.width, bottom: 1 - (s.y + s.h) / target.height };
  }
  return { top: s.top ?? 0, right: s.right ?? 0, bottom: s.bottom ?? 0, left: s.left ?? 0 };
}

export function durationBounds(target) {
  const d = target?.duration;
  if (d && typeof d === "object") return { min: d.min ?? null, max: d.max ?? null };
  return { min: target?.durationMin ?? target?.minDuration ?? null, max: target?.durationMax ?? target?.maxDuration ?? null };
}

export function isStill(comp, target) {
  const kind = comp?.kind ?? target?.kind;
  if (kind) return kind === "still";
  return !(comp?.duration > 0);
}

export const isBumper = (name, target, comp) =>
  /bumper/.test([name, comp?.file, comp?.template].join(" ")) || target?.bumper === true || comp?.bumper === true || comp?.kind === "bumper" ||
  (durationBounds(target).min === 6 && durationBounds(target).max === 6);

export function compositions(plan) {
  const comps = plan?.compositions ?? [];
  if (comps.length) return comps;
  return (plan?.targets ?? []).map((t) => ({ target: t }));
}

export async function loadTargets(names) {
  const presets = await import("../targets/presets.mjs");
  const out = {};
  for (const name of new Set(names)) {
    if (!presets.TARGETS[name]) continue;
    const t = presets.target(name);
    out[name] = { ...t, ...(t.width ? { safeBox: presets.safeBox(name) } : {}) };
  }
  return out;
}

export async function contextFromArgs(args) {
  if (!args.run || args.run === true) fail("--run <runDir> is required", 2);
  const stage = args.stage ?? "proof";
  if (!["proof", "dist"].includes(stage)) fail("--stage must be proof or dist", 2);
  const runDir = resolve(args.run);
  const plan = readJson(join(runDir, "plan.json"), {});
  const brandPath = args.brand && args.brand !== true ? resolve(args.brand) : join(runDir, "../../brand.json");
  const brand = readJson(brandPath, null);
  const names = [...(plan.targets ?? []), ...(plan.compositions ?? []).map((c) => c.target).filter(Boolean)];
  const targets = await loadTargets(names);
  return {
    runDir, stage, plan, brand, targets,
    mode: args.mode && args.mode !== true ? args.mode : plan.mode,
    ...(args.frames && args.frames !== true ? { frames: resolve(args.frames) } : {}),
  };
}

export function formatResult(r) {
  const lines = [`${r.gate}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`];
  for (const f of r.findings) lines.push(`  ${f.status.padEnd(4)} ${f.rule}  ${typeof f.evidence === "string" ? f.evidence : JSON.stringify(f.evidence)}`);
  return lines.join("\n");
}

export async function cli(run) {
  const args = parseArgs(process.argv.slice(2));
  const ctx = await contextFromArgs(args);
  const r = await run(ctx);
  process.stdout.write((args.json ? JSON.stringify(r) : formatResult(r)) + "\n");
  process.exit(r.status === "fail" ? 1 : 0);
}

export const isMain = (url) => url === `file://${process.argv[1]}`;

// Caption lines: explicit breaks are kept; an unbroken caption is wrapped
// greedily at `max` characters, as the renderer would.
export function captionLines(text, max = 42) {
  const explicit = String(text ?? "").split(/\r?\n|<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const lines = [];
  let line = "";
  for (const word of (explicit[0] ?? "").split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// Caption cues from transcript JSON (array or { captions|cues|segments|groups }), SRT or VTT.
export function readCaptionCues(path) {
  const text = readFileSync(path, "utf8");
  if (/\.(srt|vtt)$/i.test(path)) {
    return text.split(/\r?\n\r?\n/).map((block) => {
      const lines = block.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l));
      return { text: lines.join("\n") };
    }).filter((c) => c.text);
  }
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.captions ?? data.cues ?? data.segments ?? data.groups ?? [];
  return list.map((c) => ({ text: Array.isArray(c.lines) ? c.lines.join("\n") : c.text ?? "", start: c.start, end: c.end }));
}

export const words = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean);
