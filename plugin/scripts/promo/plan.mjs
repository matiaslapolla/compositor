#!/usr/bin/env node
// Promo plan: script scenes + voiceover timeline + caption cues → params.json for the
// promo templates, the seam ledger they stamp, and plan.json (audio, copy, scenes).
//
//   node plan.mjs --script script.json --run <runDir> [--assets <run>/project/_shared/assets] [--captions plain|karaoke] [--json]
//
// Reads <assets>/timeline.json and <assets>/captions.json (scripts/promo/voiceover.mjs).
// Writes <run>/params.json and merges <run>/plan.json; copies scene images into <assets>/.
import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, ensureDir } from "../lib/fs.mjs";
import { uniqueName } from "../render/build.mjs";

export const SCENE_KINDS = ["title", "claim", "feature", "capture", "stat", "quote", "end"];
const CONTENT_KEYS = ["headline", "body", "image", "stat", "label", "items"];
// Sustained-motion route per scene kind (motion-doctrine Part 2).
const ROUTES = { stat: "sequenced UI life", capture: "staged reveals", default: "staged reveals" };

const r3 = (n) => Math.round(n * 1000) / 1000;
const plainText = (s) => String(s ?? "").replace(/\*([^*]+)\*/g, "$1").trim();
export const stageSelector = (index) => `#stage-${index + 1}`;

export function checkScript(script, timeline) {
  const errors = [];
  const scenes = script?.scenes ?? [];
  if (!scenes.length) errors.push("script.scenes[] is empty");
  scenes.forEach((s, i) => {
    const at = `scene ${i + 1} "${s.id ?? "?"}"`;
    if (!SCENE_KINDS.includes(s.kind)) errors.push(`${at}: kind must be one of ${SCENE_KINDS.join("|")}`);
    if (s.kind === "stat" && !s.stat) errors.push(`${at}: a stat scene needs "stat"`);
    if (s.kind === "capture" && !s.image) errors.push(`${at}: a capture scene needs "image"`);
    if (!["stat", "capture"].includes(s.kind) && !s.headline) errors.push(`${at}: needs "headline"`);
    if (s.items && (!Array.isArray(s.items) || s.items.length > 4)) errors.push(`${at}: items is an array of at most 4 strings`);
  });
  if (timeline) {
    const ids = timeline.scenes?.map((s) => s.id) ?? [];
    if (ids.length !== scenes.length || scenes.some((s, i) => (s.id ?? `scene-${i + 1}`) !== ids[i])) {
      errors.push(`timeline scenes [${ids.join(", ")}] do not match the script; re-run voiceover.mjs`);
    }
  }
  return errors;
}

// One cut-the-curve LEFT row per seam, on the scene stage wrappers the templates move.
export function promoLedger(timeline) {
  return {
    fps: timeline.fps ?? 30,
    seams: timeline.scenes.slice(1).map((s, i) => ({
      id: `${timeline.scenes[i].id}→${s.id}`,
      cut: s.start,
      technique: "cut-the-curve LEFT",
      exit: { selector: stageSelector(i), axis: "x", dir: -1 },
      entry: { selector: stageSelector(i + 1), axis: "x", dir: -1 },
    })),
  };
}

export function promoParams(script, timeline, cues, { voSrc = null, captionStyle = "plain", images = {} } = {}) {
  const scenes = script.scenes.map((s, i) => {
    const t = timeline.scenes[i];
    const content = {};
    for (const k of CONTENT_KEYS) if (s[k] !== undefined && s[k] !== "") content[k] = k === "image" ? images[s.id] ?? s[k] : s[k];
    return { id: t.id, kind: s.kind, ...content, start: t.start, end: t.end, voStart: t.voStart, voDuration: t.voDuration };
  });
  const captions = cues.map((c) => ({ start: c.start, end: c.end, lines: c.lines, words: (c.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end })) }));
  return {
    language: script.language ?? timeline.language ?? "en",
    duration: timeline.duration,
    scenes,
    timeline: { fps: timeline.fps, duration: timeline.duration, scenes: timeline.scenes.map(({ id, start, end, voStart, voDuration, narration, caption }) => ({ id, start, end, voStart, voDuration, narration, caption })) },
    captions,
    captionStyle,
    voSrc,
    ledger: promoLedger(timeline),
  };
}

export function mergePlan(plan, { script, timeline, runDir, assetsDir, hasMix }) {
  const rel = (f) => relative(runDir, join(assetsDir, f));
  const claim = script.scenes.find((s) => s.kind === "claim" && s.headline) ?? script.scenes.find((s) => s.headline);
  const end = script.scenes.findLast((s) => s.kind === "end");
  const copy = { ...(plan.copy ?? {}), headline: plainText(claim?.headline) };
  if (end?.label) copy.cta = plainText(end.label);
  return {
    ...plan,
    mode: "promo",
    slug: plan.slug ?? basename(runDir),
    title: plan.title ?? script.title ?? copy.headline,
    copy,
    audio: {
      ...(plan.audio ?? {}),
      mix: hasMix ? rel("vo/mix.wav") : null,
      vo: null,
      music: plan.audio?.music ?? null,
      captions: rel("captions.json"),
      captionsSrt: rel("captions.srt"),
      captionsVtt: rel("captions.vtt"),
      language: script.language ?? timeline.language ?? null,
    },
    scenes: timeline.scenes.map((s, i) => ({
      id: s.id,
      kind: script.scenes[i].kind,
      start: s.start,
      duration: r3(s.end - s.start),
      route: ROUTES[script.scenes[i].kind] ?? ROUTES.default,
      carrier: stageSelector(i),
    })),
  };
}

// Images resolve against the script's folder and land in assets/ under their own name.
function copyImages(script, scriptDir, assetsDir) {
  const out = {};
  for (const s of script.scenes) {
    if (!s.image) continue;
    if (s.image.startsWith("assets/") && existsSync(join(assetsDir, s.image.slice(7)))) continue;
    const src = resolve(scriptDir, s.image);
    if (!existsSync(src)) throw Object.assign(new Error(`scene "${s.id}": image ${s.image} not found`), { usage: true });
    const name = uniqueName(ensureDir(assetsDir), src);
    copyFileSync(src, join(assetsDir, name));
    out[s.id] = `assets/${name}`;
  }
  return out;
}

export function planPromo({ scriptPath, runDir, assetsDir = join(runDir, "project", "_shared", "assets"), captionStyle = "plain" }) {
  const script = readJson(scriptPath);
  const timeline = readJson(join(assetsDir, "timeline.json"));
  const cues = readJson(join(assetsDir, "captions.json"), []);
  const errors = checkScript(script, timeline);
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { usage: true });
  const images = copyImages(script, dirname(scriptPath), assetsDir);
  const hasMix = Boolean(timeline.mix) && existsSync(join(assetsDir, timeline.mix));
  const params = promoParams(script, timeline, cues, { voSrc: hasMix ? `assets/${timeline.mix}` : null, captionStyle, images });
  writeJson(join(runDir, "params.json"), params);
  const planPath = join(runDir, "plan.json");
  const plan = mergePlan(readJson(planPath, {}), { script, timeline, runDir, assetsDir, hasMix });
  writeJson(planPath, plan);
  return { params, plan };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.script || args.script === true || !args.run || args.run === true) fail("usage: plan.mjs --script script.json --run <runDir> [--assets dir] [--captions plain|karaoke]", 2);
  if (args.captions && !["plain", "karaoke"].includes(args.captions)) fail("--captions must be plain or karaoke", 2);
  const runDir = resolve(args.run);
  let r;
  try {
    r = planPromo({ scriptPath: resolve(args.script), runDir, assetsDir: args.assets ? resolve(args.assets) : undefined, captionStyle: args.captions || "plain" });
  } catch (e) {
    fail(e.message, e.usage ? 2 : 1);
  }
  if (args.json) process.stdout.write(JSON.stringify({ ok: true, params: join(runDir, "params.json"), plan: join(runDir, "plan.json"), duration: r.params.duration, scenes: r.params.scenes.length, seams: r.params.ledger.seams.length, audio: r.plan.audio }) + "\n");
  else {
    process.stdout.write(`params ${r.params.duration}s, ${r.params.scenes.length} scenes, ${r.params.captions.length} cues, ${r.params.ledger.seams.length} seams → ${join(runDir, "params.json")}\n`);
    process.stdout.write(`plan.copy.headline "${r.plan.copy.headline}"; audio.mix ${r.plan.audio.mix ?? "none (caption-only)"}\n`);
  }
}
