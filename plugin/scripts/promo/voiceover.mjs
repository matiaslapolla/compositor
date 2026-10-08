#!/usr/bin/env node
// Promo voice-over: one Kokoro clip per scene (cached by text hash, shared with
// guide/narration.mjs), the scene timeline the promo templates play against, a
// −14 LUFS mix (music is mixed in later) and caption sidecars.
//
//   node voiceover.mjs --script script.json --out <run>/project/_shared/assets
//     [--voice af_heart|ef_dora|…] [--speed 1] [--lang en-us|es] [--caption-only] [--transcribe]
//     [--max-chars 32] [--json]
//
// script.json = { language, voice?, scenes: [{ id, narration, caption?, holdS? }] }
// Writes <out>/vo/step-NN.wav, <out>/vo/mix.wav, <out>/timeline.json, <out>/captions.{json,srt,vtt}.
import { join, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, ensureDir } from "../lib/fs.mjs";
import { probe } from "../lib/ffmpeg.mjs";
import { synthesizeAll, mixVoiceover, measureWpm, defaultVoice, transcriptWords, WPM_RANGE } from "../guide/narration.mjs";
import { wordsFromText, normalizeWords, cuesFromWords, layoutLines, captionLint, writeCaptions, CAPTION_DEFAULTS } from "../guide/captions.mjs";

export const PROMO_TIMING = {
  fps: 30,
  // First words land after the first visible change (ad rule 1).
  lead: 0.3,
  gap: 0.4,
  // The visual cut leads the next scene's voice so the picture arrives first.
  cutLead: 0.2,
  tail: 1.0,
  captionCps: 15,
  captionMin: 2.5,
};
export const PROMO_LUFS = -14;
// 9:16 big type holds 32 characters per line (ads research, captions rule 5); one cue set serves every target.
export const PROMO_CAPTIONS = { maxChars: 32, maxLines: 2 };

const r3 = (n) => Math.round(n * 1000) / 1000;
const onFrame = (t, fps = PROMO_TIMING.fps) => r3(Math.round(t * fps) / fps);
const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;

export const captionOnlySeconds = (text) => Math.max(PROMO_TIMING.captionMin, String(text || "").trim().length / PROMO_TIMING.captionCps);

// Pure: script + per-scene voice seconds → timeline. Scene i owns [start, end); cuts sit on frames.
export function buildPromoTimeline(script, durations, { vo = [] } = {}) {
  const T = PROMO_TIMING;
  const list = script?.scenes ?? [];
  if (!list.length) throw new Error("script.scenes is empty");
  const scenes = [];
  let voStart = T.lead;
  let voEnd = 0;
  list.forEach((s, i) => {
    const voDuration = Math.max(0, Number(durations[i]) || 0);
    scenes.push({
      id: s.id ?? `scene-${i + 1}`,
      start: i === 0 ? 0 : onFrame(voStart - T.cutLead),
      end: null,
      voStart: r3(voStart),
      voDuration: r3(voDuration),
      vo: vo[i] ?? null,
      narration: s.narration ?? "",
      caption: s.caption ?? s.narration ?? "",
    });
    voEnd = voStart + voDuration + Math.max(0, Number(s.holdS) || 0);
    voStart = voEnd + T.gap;
  });
  const duration = onFrame(voEnd + T.tail);
  scenes.forEach((s, i) => (s.end = i + 1 < scenes.length ? scenes[i + 1].start : duration));
  return { fps: T.fps, duration, scenes };
}

const norm = (w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

// Words of one scene: the scene text verbatim, timed by the transcript when one is given
// (word-for-word when the counts agree, else spread over the transcribed speech span),
// otherwise spread over the scene's voice span.
export function sceneWords(scene, text, transcript) {
  const fallback = () => wordsFromText(text, scene.voStart, scene.voStart + Math.max(scene.voDuration, 0.001));
  if (!transcript?.length) return fallback();
  const heard = transcript.filter((w) => w.start >= scene.start - 0.05 && w.start < scene.end && norm(w.text));
  if (!heard.length) return fallback();
  const said = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (said.length === heard.length) return said.map((t, i) => ({ text: t, start: heard[i].start, end: heard[i].end }));
  return wordsFromText(text, heard[0].start, heard.at(-1).end);
}

const CLAUSE_BREAK = /[.!?…,;:—–]["'”’)\]]*$/;
const MAX_PARTITION_WORDS = 24;

// Fewest cues that each fit the line layout and hold limits, cut where the lines balance
// and a clause ends: a short scene line never leaves a one- or two-word orphan cue.
export function partitionWords(words, o) {
  const n = words.length;
  const text = (a, b) => words.slice(a, b).map((w) => w.text).join(" ");
  const fits = (a, b) => layoutLines(text(a, b), o) !== null && words[b - 1].end - words[a].start <= o.maxHold;
  if (!n) return [];
  if (n > MAX_PARTITION_WORDS) return null;
  for (let k = 1; k <= n; k++) {
    let best = null;
    const walk = (from, cuts) => {
      if (cuts.length === k - 1) {
        if (!fits(from, n)) return;
        const bounds = [0, ...cuts, n];
        const lens = bounds.slice(1).map((b, i) => text(bounds[i], b).length);
        const score = Math.max(...lens) - Math.min(...lens) + 12 * cuts.filter((c) => !CLAUSE_BREAK.test(words[c - 1].text)).length;
        if (!best || score < best.score) best = { score, cuts };
        return;
      }
      for (let c = from + 1; c < n; c++) if (fits(from, c)) walk(c, [...cuts, c]);
    };
    walk(0, []);
    if (best) return [0, ...best.cuts, n].slice(1).map((b, i, arr) => words.slice(i ? arr[i - 1] : 0, b));
  }
  return null;
}

// Cues per scene so no cue straddles a cut; each cue ends by the next cue and by its scene's end.
export function promoCues(timeline, { captionOnly = false, transcript = null, ...options } = {}) {
  const o = { ...CAPTION_DEFAULTS, ...PROMO_CAPTIONS, ...options };
  const heard = transcript ? normalizeWords(transcript) : null;
  const cues = [];
  for (const s of timeline.scenes) {
    const text = captionOnly ? s.caption || s.narration : s.narration || s.caption;
    if (!String(text || "").trim()) continue;
    const words = sceneWords(s, text, heard);
    const pieces = partitionWords(words, o);
    const sceneCues = pieces ? pieces.flatMap((p) => cuesFromWords(p, o)) : cuesFromWords(words, o);
    sceneCues.forEach((c, i) => {
      c.end = r3(Math.min(c.end, sceneCues[i + 1]?.start ?? Infinity, s.end));
      if (c.end > c.start) cues.push(c);
    });
  }
  return cues;
}

export async function voiceover({ scriptPath, outDir, voice, speed = 1, lang, captionOnly = false, useTranscript = false, maxChars, synth }) {
  const script = readJson(scriptPath);
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw Object.assign(new Error("script.scenes[] is required"), { usage: true });
  const missing = script.scenes.filter((s) => !String(s.narration || s.caption || "").trim()).map((s) => s.id);
  if (missing.length) throw Object.assign(new Error(`scenes without narration or caption: ${missing.join(", ")}`), { usage: true });
  const defaults = defaultVoice(lang || script.language);
  const v = { voice: voice || script.voice || defaults.voice, speed, lang: lang || defaults.lang };
  ensureDir(outDir);

  let vo = [], durations;
  if (captionOnly) durations = script.scenes.map((s) => captionOnlySeconds(s.caption || s.narration));
  else {
    vo = await synthesizeAll({ steps: script.scenes }, outDir, { ...v, synth });
    durations = vo.map((rel) => (rel ? probe(join(outDir, rel)).duration : 0));
  }
  const timeline = buildPromoTimeline(script, durations, { vo });
  const mix = captionOnly ? null : mixVoiceover({ duration: timeline.duration, steps: timeline.scenes }, outDir, { lufs: PROMO_LUFS });
  const wpm = captionOnly ? null : measureWpm({ steps: script.scenes }, durations);
  const transcript = useTranscript && mix ? transcriptWords(join(outDir, mix.file), outDir, v.lang) : null;
  const options = maxChars ? { maxChars } : {};
  const cues = promoCues(timeline, { captionOnly, transcript, ...options });
  const captionFiles = writeCaptions(cues, join(outDir, "captions"));
  const captionFindings = captionLint(cues, { ...PROMO_CAPTIONS, ...options });
  const doc = { ...timeline, language: script.language ?? v.lang, mix: mix?.file ?? null, captions: "captions.json", voice: captionOnly ? null : v, wpm, timedBy: transcript ? "transcript" : "text" };
  writeJson(join(outDir, "timeline.json"), doc);
  return { timeline: doc, mix, wpm, cues, captionFiles, captionFindings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.script || args.script === true) fail("--script script.json is required", 2);
  if (!args.out || args.out === true) fail("--out <run>/project/_shared/assets is required", 2);
  let r;
  try {
    r = await voiceover({
      scriptPath: resolve(args.script),
      outDir: resolve(args.out),
      voice: args.voice,
      speed: args.speed ? Number(args.speed) : 1,
      lang: args.lang,
      captionOnly: Boolean(args["caption-only"]),
      useTranscript: Boolean(args.transcribe),
      maxChars: args["max-chars"] ? Number(args["max-chars"]) : undefined,
    });
  } catch (e) {
    fail(e.message, e.usage ? 2 : 1);
  }
  const { timeline, mix, wpm, cues, captionFindings } = r;
  const warnings = [];
  if (wpm && !wpm.inRange) warnings.push(`narration pace ${wpm.overall} wpm outside ${WPM_RANGE.join("–")}`);
  if (mix && Math.abs(mix.loudness.integrated - PROMO_LUFS) > 1) warnings.push(`mix measured ${mix.loudness.integrated} LUFS, target ${PROMO_LUFS}`);
  for (const f of captionFindings) warnings.push(`${f.rule}: ${f.evidence}`);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, duration: timeline.duration, scenes: timeline.scenes.length, mix: mix?.file ?? null, loudness: mix?.loudness ?? null, wpm: wpm?.overall ?? null, wpmScenes: wpm?.steps ?? null, captions: cues.length, timedBy: timeline.timedBy, warnings }) + "\n");
  } else {
    process.stdout.write(`timeline ${timeline.duration}s, ${timeline.scenes.length} scenes → ${join(resolve(args.out), "timeline.json")}\n`);
    timeline.scenes.forEach((s, i) => process.stdout.write(`  ${s.id.padEnd(10)} ${s.start.toFixed(2)}–${s.end.toFixed(2)}  vo ${s.voStart.toFixed(2)}+${s.voDuration.toFixed(2)}  ${wordCount(s.narration)} words${wpm?.steps[i]?.wpm ? `, ${wpm.steps[i].wpm} wpm` : ""}\n`));
    if (mix) process.stdout.write(`mix ${mix.file} at ${mix.loudness.integrated} LUFS / ${mix.loudness.truePeak} dBTP, measured ${wpm.overall} wpm\n`);
    process.stdout.write(`${cues.length} caption cues (${timeline.timedBy} timing)\n`);
    for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
  }
}
