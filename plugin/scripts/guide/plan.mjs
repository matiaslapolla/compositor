#!/usr/bin/env node
// Merge the capture manifest and the narration timeline into the params the
// guide/tutorial template plays, and the plan.json the gates and deliver read.
//
//   node plan.mjs --run <runDir> --manifest <captures/manifest.json> --timeline <assets/timeline.json>
//     [--captions assets/captions.json] [--title "…"] [--caption-only] [--spotlight] [--json]
//
// The composition opens on a title card, so every time is shifted by OVERLAY.intro
// and the video ends on a static frame of OVERLAY.outro. Writes:
//   <run>/params.json
//   <run>/plan.json                                   (mode, title, steps, audio, guide)
//   <run>/project/_shared/assets/guide-overlay.js     (overlay.mjs for the browser)
//   <run>/project/_shared/assets/guide-captions.{json,srt,vtt}   (cues on the video clock)
//   <run>/project/_shared/assets/vo/guide-mix.wav     (mix.wav delayed by the intro, padded to the duration)
//   <captures>/step-NN-blank.png                      (type steps: the field with its text removed)
// Each click/hover/press step also gets `resultBox`: where its result shows up, so the camera can follow it.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, writeText, ensureDir } from "../lib/fs.mjs";
import { ffmpeg } from "../lib/ffmpeg.mjs";
import { loadSharp } from "../lib/browser.mjs";
import { planSteps } from "./narration.mjs";
import { writeCaptions } from "./captions.mjs";
import * as overlay from "./overlay.mjs";

const { OVERLAY } = overlay;
const r3 = (n) => Math.round(n * 1000) / 1000;
const shift = (v, by) => (v == null ? v : r3(v + by));
const TIME_KEYS = ["start", "end", "clickAt", "zoomIn", "zoomOut"];

// Pure: manifest + timeline (+ cues) → template params. Times on the video clock.
export function mergeSteps(manifest, timeline, { intro = OVERLAY.intro, platesDir = "assets/captures" } = {}) {
  if (manifest.steps.length !== timeline.steps.length) throw new Error(`manifest has ${manifest.steps.length} steps, timeline ${timeline.steps.length}`);
  return manifest.steps.map((m, i) => {
    const t = timeline.steps[i];
    if (t.id !== m.id) throw new Error(`step ${i + 1}: manifest id "${m.id}" vs timeline id "${t.id}"`);
    const step = {
      id: m.id,
      index: i + 1,
      action: m.action,
      ...Object.fromEntries(TIME_KEYS.map((k) => [k, shift(t[k], intro)])),
      travel: t.travel,
      zoom: t.zoom ?? m.zoom ?? 1,
      zoomGroup: t.zoomGroup ?? null,
      path: m.path,
      bbox: m.bbox ?? null,
      center: m.center,
      plate: `${platesDir}/${m.plate}`,
      afterPlate: `${platesDir}/${m.afterPlate}`,
      caption: t.caption || m.caption || "",
      narration: m.narration ?? "",
    };
    if (m.typed) step.typed = { ...m.typed };
    return step;
  });
}

export function buildParams({ manifest, timeline, cues = [], title, captionOnly = false, spotlight = false, intro = OVERLAY.intro, outro = OVERLAY.outro }) {
  return {
    title: title || manifest.title || "Tutorial",
    steps: mergeSteps(manifest, timeline, { intro }),
    viewport: manifest.viewport,
    scale: manifest.scale ?? 1,
    captions: cues.map((c) => ({ ...c, start: r3(c.start + intro), end: r3(c.end + intro), ...(c.words ? { words: c.words.map((w) => ({ ...w, start: r3(w.start + intro), end: r3(w.end + intro) })) } : {}) })),
    duration: r3(intro + timeline.duration + outro),
    captionOnly: Boolean(captionOnly),
    spotlight: Boolean(spotlight),
    intro,
    outro,
    endAt: r3(intro + timeline.duration),
  };
}

// Columns and rows of `rect` whose pixels differ from `bg` by more than `threshold` (sum of channel deltas).
export function inkExtent(data, width, channels, rect, bg, threshold = 90) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const o = (y * width + x) * channels;
      if (Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]) <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, x1: x1 + 1, y0, y1: y1 + 1 };
}

// Changed cells → boxes of 8-connected regions, cells merged across gaps of `bridge` cells.
export function changeRegions(changed, cols, rows, bridge = 2) {
  const seen = new Uint8Array(cols * rows);
  const out = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    const box = { c0: Infinity, r0: Infinity, c1: -Infinity, r1: -Infinity };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const c = i % cols, r = (i - c) / cols;
      box.c0 = Math.min(box.c0, c); box.c1 = Math.max(box.c1, c); box.r0 = Math.min(box.r0, r); box.r1 = Math.max(box.r1, r);
      for (let dr = -bridge; dr <= bridge; dr++) for (let dc = -bridge; dc <= bridge; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (changed[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    out.push(box);
  }
  return out;
}


const inside = (a, b, pad = 0) => a.x >= b.x - pad && a.y >= b.y - pad && a.x + a.w <= b.x + b.w + pad && a.y + a.h <= b.y + b.h + pad;

// Where a click's result shows up: the regions that changed between the plates,
// minus those inside the target itself (its pressed state). A result drawn right
// beside the target, such as a tag under a button, is kept. `pageChange` when the
// changes span more than half the viewport: the click swapped the page.
export async function clickEffect(capturesDir, step, viewport, scale, { cell = 8, threshold = 48, minPixels = 3 } = {}) {
  const none = { resultBox: null, pageChange: false };
  const sharp = loadSharp();
  const read = (f) => sharp(join(capturesDir, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([read(basename(step.plate)), read(basename(step.afterPlate))]);
  const { width, height, channels } = a.info;
  if (b.info.width !== width || b.info.height !== height) return { resultBox: null, pageChange: true };
  const px = Math.round(cell * scale);
  const cols = Math.ceil(width / px), rows = Math.ceil(height / px);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * channels;
    if (Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]) > threshold) counts[Math.floor(y / px) * cols + Math.floor(x / px)]++;
  }
  const changed = Array.from(counts, (n) => n >= minPixels);
  const boxes = changeRegions(changed, cols, rows)
    .map((r) => ({ x: r.c0 * cell, y: r.r0 * cell, w: (r.c1 - r.c0 + 1) * cell, h: (r.r1 - r.r0 + 1) * cell }))
    .filter((r) => !step.bbox || !inside(r, step.bbox, cell));
  if (!boxes.length) return none;
  const x0 = Math.min(...boxes.map((r) => r.x)), y0 = Math.min(...boxes.map((r) => r.y));
  const x1 = Math.min(viewport.width, Math.max(...boxes.map((r) => r.x + r.w))), y1 = Math.min(viewport.height, Math.max(...boxes.map((r) => r.y + r.h)));
  if ((x1 - x0) * (y1 - y0) > 0.5 * viewport.width * viewport.height) return { resultBox: null, pageChange: true };
  return { resultBox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pageChange: false };
}

// A click that swaps the page leaves nothing to see where it landed. Inside a
// zoom group its zoom closes once the ripple settles; opening a group, it does
// not zoom at all (an in-and-out within a second). The steps after it in its
// group start a group of their own.
export function closeZoomOnPageChange(steps, ripple = overlay.OVERLAY.ripple.duration) {
  let next = Math.max(0, ...steps.map((s) => s.zoomGroup ?? 0)) + 1;
  steps.forEach((s, i) => {
    if (!s.pageChange || s.zoomOut == null || s.clickAt == null) return;
    const group = s.zoomGroup;
    let id = null;
    for (let j = i + 1; j < steps.length && steps[j].zoomGroup != null && steps[j].zoomGroup === group; j++) steps[j].zoomGroup = id ??= next++;
    if (steps[i - 1]?.zoomGroup === group) s.zoomOut = Math.min(s.zoomOut, r3(s.clickAt + ripple));
    else Object.assign(s, { zoom: 1, zoomIn: null, zoomOut: null, zoomGroup: null });
  });
  return steps;
}

// A type step needs a field without text for the first key (the placeholder
// vanishes at once) and the span of the typed text for the reveal.
export async function typingPlate(capturesDir, step, scale) {
  const sharp = loadSharp();
  const read = (f) => sharp(join(capturesDir, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [before, after] = await Promise.all([read(basename(step.plate)), read(basename(step.afterPlate))]);
  const { width, height, channels } = after.info;
  const b = step.bbox;
  const inset = Math.round(5 * scale);
  const rect = { x0: Math.max(0, Math.round(b.x * scale) + inset), y0: Math.max(0, Math.round(b.y * scale) + inset), x1: Math.min(width, Math.round((b.x + b.w) * scale) - inset), y1: Math.min(height, Math.round((b.y + b.h) * scale) - inset) };
  const bgAt = (img) => {
    const o = (Math.round((rect.y0 + rect.y1) / 2) * width + rect.x1 - 2) * channels;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  const bg = bgAt(after);
  const typed = inkExtent(after.data, width, channels, rect, bg);
  const old = inkExtent(before.data, width, channels, rect, bgAt(before));
  if (!typed) return null;
  const box = [typed, old].filter(Boolean).reduce((a, e) => ({ x0: Math.min(a.x0, e.x0), y0: Math.min(a.y0, e.y0), x1: Math.max(a.x1, e.x1), y1: Math.max(a.y1, e.y1) }));
  const pad = Math.round(2 * scale);
  const fill = { x0: Math.max(rect.x0, box.x0 - pad), y0: Math.max(rect.y0, box.y0 - pad), x1: Math.min(rect.x1, box.x1 + pad), y1: Math.min(rect.y1, box.y1 + pad) };
  const blank = Buffer.from(after.data);
  for (let y = fill.y0; y < fill.y1; y++) for (let x = fill.x0; x < fill.x1; x++) {
    const o = (y * width + x) * channels;
    blank[o] = bg[0]; blank[o + 1] = bg[1]; blank[o + 2] = bg[2];
  }
  const file = basename(step.plate).replace(/\.png$/i, "-blank.png");
  await sharp(blank, { raw: { width, height, channels } }).png().toFile(join(capturesDir, file));
  return { blankPlate: file, reveal: [r3((typed.x0 - pad) / scale), r3((typed.x1 + pad) / scale)] };
}

// The browser copy of overlay.mjs: every export, as declarations, under window.GuideOverlay.
export function overlayScript(mod = overlay) {
  const names = Object.keys(mod).filter((k) => k !== "default").sort();
  const body = names.map((k) => (typeof mod[k] === "function" ? mod[k].toString() : `const ${k} = ${JSON.stringify(mod[k])};`)).join("\n\n");
  return `// Generated by scripts/guide/plan.mjs from scripts/guide/overlay.mjs. Do not edit.\n(function () {\n${body}\n\nwindow.GuideOverlay = { ${names.join(", ")} };\n})();\n`;
}

function padMix(src, dest, { intro, duration }) {
  ensureDir(dirname(dest));
  ffmpeg(["-y", "-i", src, "-af", `adelay=${Math.round(intro * 1000)}:all=1,apad=whole_dur=${duration}`, "-t", String(duration), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dest]);
  return dest;
}

export async function plan({ runDir, manifestPath, timelinePath, captionsPath, title, captionOnly, spotlight }) {
  const manifest = readJson(manifestPath);
  const timeline = readJson(timelinePath);
  const assetsDir = dirname(timelinePath);
  const capPath = captionsPath ?? join(assetsDir, timeline.captions ?? "captions.json");
  const cues = existsSync(capPath) ? readJson(capPath) : [];
  const caponly = Boolean(captionOnly ?? !timeline.mix);
  const params = buildParams({ manifest, timeline, cues, title, captionOnly: caponly, spotlight });

  const capturesDir = dirname(manifestPath);
  for (const s of params.steps) {
    if (["click", "hover", "press"].includes(s.action)) Object.assign(s, await clickEffect(capturesDir, s, params.viewport, params.scale));
    if (s.action !== "type" || !s.bbox || !s.typed) continue;
    const r = await typingPlate(capturesDir, s, params.scale);
    if (!r) continue;
    s.typed.reveal = r.reveal;
    s.blankPlate = `assets/captures/${r.blankPlate}`;
  }
  closeZoomOnPageChange(params.steps);

  const shared = ensureDir(join(runDir, "project", "_shared", "assets"));
  writeText(join(shared, "guide-overlay.js"), overlayScript());
  const rel = (p) => relative(runDir, p);
  const captionFiles = writeCaptions(params.captions, join(shared, "guide-captions"));
  const mixSrc = timeline.mix ? resolve(assetsDir, timeline.mix) : null;
  const mix = !caponly && mixSrc && existsSync(mixSrc) ? padMix(mixSrc, join(shared, "vo", "guide-mix.wav"), { intro: params.intro, duration: params.duration }) : null;
  if (!caponly && !mix) throw new Error(`timeline mix ${timeline.mix ?? "(none)"} not found; run narration.mjs or pass --caption-only`);
  params.audio = mix ? "assets/vo/guide-mix.wav" : null;

  writeJson(join(runDir, "params.json"), params);
  const planPath = join(runDir, "plan.json");
  const prev = readJson(planPath, {});
  const steps = planSteps(manifest, timeline).map((s) => ({ ...s, start: shift(s.start, params.intro), actionAt: shift(s.actionAt, params.intro) }));
  const doc = {
    ...prev,
    mode: "guide",
    slug: prev.slug ?? basename(runDir),
    title: params.title,
    steps,
    audio: {
      ...(prev.audio ?? {}),
      mix: mix ? rel(mix) : null,
      vo: mix ? rel(mix) : null,
      captions: rel(captionFiles.find((f) => f.endsWith(".json"))),
      captionsSrt: rel(captionFiles.find((f) => f.endsWith(".srt"))),
      captionsVtt: rel(captionFiles.find((f) => f.endsWith(".vtt"))),
      language: manifest.locale ?? null,
    },
    guide: { captionOnly: caponly, spotlight: params.spotlight, intro: params.intro, outro: params.outro, duration: params.duration },
  };
  writeJson(planPath, doc);
  return { params, plan: doc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  for (const k of ["run", "manifest", "timeline"]) if (!args[k] || args[k] === true) fail(`--${k} is required. usage: plan.mjs --run <dir> --manifest captures/manifest.json --timeline assets/timeline.json [--captions …] [--title …] [--caption-only] [--spotlight]`, 2);
  let r;
  try {
    r = await plan({
      runDir: resolve(args.run),
      manifestPath: resolve(args.manifest),
      timelinePath: resolve(args.timeline),
      captionsPath: args.captions && args.captions !== true ? resolve(args.captions) : undefined,
      title: args.title && args.title !== true ? args.title : undefined,
      captionOnly: args["caption-only"] ? true : undefined,
      spotlight: Boolean(args.spotlight),
    });
  } catch (e) {
    fail(e.message, 1);
  }
  const { params, plan: p } = r;
  if (args.json) process.stdout.write(JSON.stringify({ ok: true, duration: params.duration, steps: params.steps.length, captions: params.captions.length, captionOnly: params.captionOnly, audio: p.audio }) + "\n");
  else {
    process.stdout.write(`params ${params.steps.length} steps, ${params.captions.length} cues, ${params.duration}s${params.captionOnly ? " (caption-only)" : ""} → ${join(resolve(args.run), "params.json")}\n`);
    if (p.audio.mix) process.stdout.write(`mix ${p.audio.mix}\n`);
  }
}
