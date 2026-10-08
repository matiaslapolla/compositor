#!/usr/bin/env node
// Voice-over per step (Kokoro via `hyperframes tts`), the step timeline the
// overlay composition plays against, a single −16 LUFS narration mix, and
// sidecar captions.
//
//   node narration.mjs --manifest captures/manifest.json --out <dir>
//     [--voice af_heart|ef_dora|…] [--speed 1] [--lang en-us|es] [--caption-only] [--transcribe] [--json]
//
// Writes <dir>/vo/step-NN.wav, <dir>/vo/mix.wav, <dir>/timeline.json, <dir>/captions.{json,srt,vtt}.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, ensureDir } from "../lib/fs.mjs";
import { tts, transcribe } from "../lib/hyperframes.mjs";
import { ffmpeg, probe, loudness, loudnormFilter } from "../lib/ffmpeg.mjs";
import { wordsFromText, cuesFromWords, captionLint, writeCaptions } from "./captions.mjs";

export const TIMING = {
  fps: 30,
  pause: 0.5,
  pauseUi: 0.8,
  voPad: 0.6,
  minStep: 2,
  travelMin: 0.35,
  travelMax: 0.6,
  zoomLead: 0.3,
  hold: 1.2,
  zoomOut: 0.7,
  mergeGap: 1.5,
  tail: 0.5,
  captionCps: 15,
  captionMin: 1.2,
};
export const WPM_RANGE = [140, 165];
export const LUFS = -16;

const r3 = (n) => Math.round(n * 1000) / 1000;
const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
export const nn = (index) => String(index + 1).padStart(2, "0");

export const captionOnlySeconds = (text) => Math.max(TIMING.captionMin, String(text || "").length / TIMING.captionCps);
export const estimateSpeechSeconds = (text, wpm = 150) => (wordCount(text) / wpm) * 60;

// Pointer moves, typing, clicks, key presses and navigation alter the page; a
// measured `changesUi` from the capture wins over this guess.
const UI_ACTIONS = new Set(["navigate", "click", "type", "press"]);
const changesUi = (step) => step.changesUi ?? UI_ACTIONS.has(step.action);

export function defaultVoice(locale = "en") {
  const l = String(locale).toLowerCase();
  if (l.startsWith("es")) return { voice: "ef_dora", lang: "es" };
  if (l === "en-gb") return { voice: "bf_emma", lang: "en-gb" };
  return { voice: "af_heart", lang: "en-us" };
}

// Pure: manifest + per-step speech seconds → timeline. `vo[i]` null means no audio file.
export function buildTimeline(manifest, durations, { vo = [] } = {}) {
  const { width, height } = manifest.viewport;
  const diag = Math.hypot(width, height);
  const steps = [];
  let prevEnd = 0;
  manifest.steps.forEach((s, i) => {
    const prev = manifest.steps[i - 1];
    const start = prevEnd + (prev && changesUi(prev) ? TIMING.pauseUi : TIMING.pause);
    const path = s.path || [];
    const dist = path.length > 1 ? Math.hypot(path.at(-1)[0] - path[0][0], path.at(-1)[1] - path[0][1]) : 0;
    const travel = dist > 1 ? TIMING.travelMin + (TIMING.travelMax - TIMING.travelMin) * Math.min(1, dist / diag) : 0;
    const clickAt = start + travel;
    const voDuration = Number(durations[i]) || 0;
    const hold = Math.max(TIMING.hold, (Number(s.holdMs) || 0) / 1000);
    const zoomed = (s.zoom ?? 1) > 1;
    const end = Math.max(start + Math.max(voDuration + TIMING.voPad, TIMING.minStep), clickAt + hold + (zoomed ? TIMING.zoomOut : 0));
    steps.push({
      id: s.id,
      start: r3(start),
      end: r3(end),
      travel: r3(travel),
      clickAt: r3(clickAt),
      zoomIn: zoomed ? r3(Math.max(0, clickAt - TIMING.zoomLead)) : null,
      zoomOut: zoomed ? r3(end - TIMING.zoomOut) : null,
      zoom: s.zoom ?? 1,
      zoomGroup: null,
      vo: vo[i] ?? null,
      voStart: r3(start),
      voDuration: r3(voDuration),
      caption: s.caption ?? "",
    });
    prevEnd = end;
  });
  assignZoomGroups(steps);
  return { fps: TIMING.fps, duration: r3(prevEnd + TIMING.tail), steps };
}

// Consecutive zoomed steps whose zoom segments are < mergeGap apart share a
// group: the overlay zooms in once, pans between targets, zooms out once.
export function assignZoomGroups(steps) {
  let group = 0;
  steps.forEach((s, i) => {
    if (s.zoomIn === null) return void (s.zoomGroup = null);
    const prev = steps[i - 1];
    const merges = prev && prev.zoomGroup !== null && s.zoomIn - (prev.zoomOut + TIMING.zoomOut) < TIMING.mergeGap;
    s.zoomGroup = merges ? prev.zoomGroup : ++group;
  });
  return steps;
}

// plan.json `steps` in the shape gates/guide-lint.mjs reads.
export function planSteps(manifest, timeline) {
  return timeline.steps.map((t, i) => ({
    index: i + 1,
    id: t.id,
    start: t.start,
    duration: r3(t.end - t.start),
    actionAt: t.clickAt,
    zoom: t.zoom,
    zoomGroup: t.zoomGroup,
    narration: manifest.steps[i].narration,
    caption: t.caption,
    captionDuration: t.voDuration,
  }));
}

export function measureWpm(manifest, durations) {
  const rows = manifest.steps.map((s, i) => {
    const words = wordCount(s.narration);
    const d = Number(durations[i]) || 0;
    return { id: s.id, words, seconds: r3(d), wpm: d > 0 ? Math.round((words / d) * 60) : null };
  });
  const words = rows.reduce((a, r) => a + r.words, 0);
  const seconds = rows.reduce((a, r) => a + r.seconds, 0);
  const overall = seconds > 0 ? Math.round((words / seconds) * 60) : null;
  const out = (w) => w !== null && (w < WPM_RANGE[0] || w > WPM_RANGE[1]);
  return { overall, inRange: !out(overall), steps: rows, outliers: rows.filter((r) => out(r.wpm)).map((r) => r.id) };
}

const textHash = (parts) => createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

function ttsSynth(text, path, { voice, speed, lang }) {
  const r = tts(text, { out: path, voice, speed, lang });
  if (r.status !== 0 || !existsSync(path)) throw new Error(`tts failed (${voice}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" | ")}`);
}

// Synthesizes each step into vo/cache/<hash>.wav once, copies it to vo/step-NN.wav.
export async function synthesizeAll(manifest, outDir, { voice, speed = 1, lang, synth = ttsSynth } = {}) {
  const voDir = ensureDir(join(outDir, "vo"));
  const cacheDir = ensureDir(join(voDir, "cache"));
  const files = [];
  for (const [i, s] of manifest.steps.entries()) {
    const text = String(s.narration || "").trim();
    if (!text) {
      files.push(null);
      continue;
    }
    const cached = join(cacheDir, `${textHash([text, voice, speed, lang])}.wav`);
    if (!existsSync(cached)) {
      try {
        await synth(text, cached, { voice, speed, lang });
      } catch (e) {
        throw new Error(`step ${i + 1} "${s.id}": ${e.message}`);
      }
    }
    const rel = `vo/step-${nn(i)}.wav`;
    copyFileSync(cached, join(outDir, rel));
    files.push(rel);
  }
  return files;
}

// Every clip delayed to its voStart, summed (clips never overlap), padded to the
// full duration, then two-pass loudnorm to −16 LUFS, 48 kHz mono.
export function mixVoiceover(timeline, outDir, { lufs = LUFS } = {}) {
  const clips = timeline.steps.filter((s) => s.vo);
  if (!clips.length) return null;
  const raw = join(outDir, "vo", "mix.raw.wav");
  const out = join(outDir, "vo", "mix.wav");
  const inputs = clips.flatMap((s) => ["-i", join(outDir, s.vo)]);
  const chains = clips.map((s, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(s.voStart * 1000)}:all=1[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad=whole_dur=${timeline.duration}[m]`;
  ffmpeg(["-y", ...inputs, "-filter_complex", [...chains, mix].join(";"), "-map", "[m]", "-t", String(timeline.duration), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", raw]);
  const filter = loudnormFilter(raw, { I: lufs, TP: -1.5, LRA: 11 });
  ffmpeg(["-y", "-i", raw, "-af", filter, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out]);
  rmSync(raw, { force: true });
  return { file: "vo/mix.wav", loudness: loudness(out) };
}

export function transcriptWords(mixPath, outDir, lang) {
  const dir = ensureDir(join(outDir, "transcript"));
  const model = lang && !lang.startsWith("en") ? "small" : undefined;
  const r = transcribe(mixPath, { dir, lang: lang?.slice(0, 2), model });
  const file = join(dir, "transcript.json");
  if (existsSync(file)) return readJson(file);
  if (Array.isArray(r.data) || r.data?.words) return r.data;
  throw new Error(`transcribe produced no transcript.json: ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
}

export async function narrate({ manifestPath, outDir, voice, speed = 1, lang, captionOnly = false, useTranscript = false, synth }) {
  const manifest = readJson(manifestPath);
  const defaults = defaultVoice(manifest.locale);
  const v = { voice: voice || defaults.voice, speed, lang: lang || defaults.lang };
  ensureDir(outDir);

  let vo = [], durations;
  if (captionOnly) durations = manifest.steps.map((s) => captionOnlySeconds(s.caption || s.narration));
  else {
    vo = await synthesizeAll(manifest, outDir, { ...v, synth });
    durations = vo.map((rel) => (rel ? probe(join(outDir, rel)).duration : 0));
  }

  const timeline = buildTimeline(manifest, durations, { vo });
  const mix = captionOnly ? null : mixVoiceover(timeline, outDir);
  const wpm = captionOnly ? null : measureWpm(manifest, durations);

  let cues;
  if (useTranscript && mix) cues = cuesFromWords(transcriptWords(join(outDir, mix.file), outDir, v.lang));
  else {
    // One pass over every step's words so hold extensions never run into the next step's cues.
    const words = timeline.steps.flatMap((t, i) => {
      const s = manifest.steps[i];
      const text = captionOnly ? s.caption || s.narration : s.narration || s.caption;
      return wordsFromText(text, t.voStart, t.voStart + t.voDuration);
    });
    cues = cuesFromWords(words);
  }
  const captionFiles = writeCaptions(cues, join(outDir, "captions"));
  const captionFindings = captionLint(cues);

  const doc = {
    ...timeline,
    mix: mix?.file ?? null,
    captions: "captions.json",
    voice: captionOnly ? null : v,
    wpm,
  };
  writeJson(join(outDir, "timeline.json"), doc);
  return { timeline: doc, mix, wpm, cues: cues.length, captionFiles, captionFindings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || args.manifest === true) fail("--manifest captures/manifest.json is required", 2);
  const manifestPath = resolve(args.manifest);
  const outDir = resolve(args.out && args.out !== true ? args.out : dirname(dirname(manifestPath)));
  let result;
  try {
    result = await narrate({
      manifestPath,
      outDir,
      voice: args.voice,
      speed: args.speed ? Number(args.speed) : 1,
      lang: args.lang,
      captionOnly: Boolean(args["caption-only"]),
      useTranscript: Boolean(args.transcribe),
    });
  } catch (e) {
    fail(e.message, 1);
  }
  const { timeline, mix, wpm, captionFindings } = result;
  const warnings = [];
  if (wpm && !wpm.inRange) warnings.push(`narration pace ${wpm.overall} wpm outside ${WPM_RANGE.join("–")}`);
  if (wpm?.outliers.length) warnings.push(`steps outside ${WPM_RANGE.join("–")} wpm: ${wpm.outliers.join(", ")}`);
  if (mix && Math.abs(mix.loudness.integrated - LUFS) > 1) warnings.push(`mix measured ${mix.loudness.integrated} LUFS, target ${LUFS}`);
  for (const f of captionFindings) warnings.push(`${f.rule}: ${f.evidence}`);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, out: outDir, duration: timeline.duration, steps: timeline.steps.length, mix: mix?.file ?? null, loudness: mix?.loudness ?? null, wpm: wpm?.overall ?? null, captions: result.cues, warnings }) + "\n");
  } else {
    process.stdout.write(`timeline ${timeline.duration}s, ${timeline.steps.length} steps → ${join(outDir, "timeline.json")}\n`);
    if (mix) process.stdout.write(`mix ${mix.file} at ${mix.loudness.integrated} LUFS, ${wpm.overall} wpm\n`);
    for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
  }
}
