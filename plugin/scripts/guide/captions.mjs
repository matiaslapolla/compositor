#!/usr/bin/env node
// Caption cues from word timings (or from a known sentence over a span), with
// SRT/VTT/JSON writers and the lint the gates reuse. Shared by guide and promo.
//
//   node captions.mjs --words transcript.json --out captions.srt
//   node captions.mjs --text line.txt --start 1.2 --end 4.8 --out captions   (writes .json .srt .vtt)
//   [--max-chars 42] [--max-lines 2] [--max-cps 20] [--json]
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeText } from "../lib/fs.mjs";

export const CAPTION_DEFAULTS = { maxChars: 42, maxLines: 2, maxCps: 20, minHold: 0.83, maxHold: 7 };

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/;
const CONJUNCTIONS = new Set([
  "and", "but", "or", "so", "because", "then", "when", "while", "if", "until", "after", "before", "which", "that", "to",
  "y", "e", "pero", "o", "u", "porque", "entonces", "cuando", "mientras", "si", "hasta", "después", "antes", "que", "para",
]);
// A conjunction only opens a clause once the running clause has this many words.
const MIN_CLAUSE_WORDS = 3;
// A silence this long ends a clause; adjacent pieces closer than this may share a cue.
const MERGE_GAP = 1.0;

const r3 = (n) => Math.round(n * 1000) / 1000;
const textOf = (words) => words.map((w) => w.text).join(" ");

// Accepts the transcribe shape [{id,text,start,end}] (word or segment level),
// { words } / { segments }, and splits multi-word entries by character weight.
export function normalizeWords(input) {
  const list = Array.isArray(input) ? input : input?.words || input?.segments || [];
  const out = [];
  for (const entry of list) {
    const text = String(entry.text ?? entry.word ?? "").trim();
    const start = Number(entry.start), end = Number(entry.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const parts = text.split(/\s+/);
    if (parts.length === 1) out.push({ text, start: r3(start), end: r3(Math.max(start, end)) });
    else out.push(...spreadByWeight(parts, start, end));
  }
  return out;
}

function spreadByWeight(parts, start, end) {
  const weights = parts.map((p) => p.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, end - start);
  let t = start;
  return parts.map((text, i) => {
    const w = { text, start: r3(t), end: r3(t + (span * weights[i]) / total) };
    t += (span * weights[i]) / total;
    if (i === parts.length - 1) w.end = r3(end);
    return w;
  });
}

// Best line layout for a text, or null when it cannot fit maxLines × maxChars.
export function layoutLines(text, { maxChars = 42, maxLines = 2 } = {}) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= maxChars) return [text];
  if (maxLines < 2) return null;
  if (maxLines === 2) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      if (a.length > maxChars || b.length > maxChars) continue;
      // Balanced lines; a break after punctuation or before a conjunction is worth 6 chars of imbalance.
      const bonus = CLAUSE_END.test(words[i - 1]) || SENTENCE_END.test(words[i - 1]) ? 6 : CONJUNCTIONS.has(words[i].toLowerCase()) ? 3 : 0;
      const score = Math.abs(a.length - b.length) - bonus;
      if (!best || score < best.score) best = { score, lines: [a, b] };
    }
    return best?.lines ?? null;
  }
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (w.length > maxChars) return null;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else (lines.push(cur), (cur = w));
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

function splitClauses(words) {
  const clauses = [];
  let cur = [];
  for (const w of words) {
    const pause = cur.length && w.start - cur.at(-1).end >= MERGE_GAP;
    if (pause || (cur.length >= MIN_CLAUSE_WORDS && CONJUNCTIONS.has(w.text.toLowerCase().replace(/[^\p{L}]/gu, "")))) {
      clauses.push(cur);
      cur = [];
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text) || CLAUSE_END.test(w.text)) {
      clauses.push(cur);
      cur = [];
    }
  }
  if (cur.length) clauses.push(cur);
  return clauses;
}

const span = (words) => words.at(-1).end - words[0].start;

function fits(words, o) {
  return layoutLines(textOf(words), o) !== null && span(words) <= o.maxHold;
}

// Smallest n for which cutting at word boundaries nearest k·total/n yields pieces that all fit.
function splitByLength(words, o) {
  if (fits(words, o)) return [words];
  const total = textOf(words).length;
  for (let n = 2; n <= words.length; n++) {
    const pieces = [];
    let from = 0, acc = 0;
    const offsets = words.map((w) => (acc += w.text.length + 1) - 1);
    for (let k = 1; k < n; k++) {
      const target = (total * k) / n;
      let cut = from + 1;
      while (cut < words.length - (n - k) && Math.abs(offsets[cut] - target) < Math.abs(offsets[cut - 1] - target)) cut++;
      pieces.push(words.slice(from, cut));
      from = cut;
    }
    pieces.push(words.slice(from));
    if (pieces.every((p) => p.length && fits(p, o))) return pieces;
  }
  return words.map((w) => [w]);
}

export function cuesFromWords(input, options = {}) {
  const o = { ...CAPTION_DEFAULTS, ...options };
  const words = normalizeWords(input);
  if (!words.length) return [];
  const pieces = splitClauses(words).flatMap((c) => splitByLength(c, o));

  const groups = [];
  for (const piece of pieces) {
    const prev = groups.at(-1);
    const joinable =
      prev &&
      !SENTENCE_END.test(prev.at(-1).text) &&
      piece[0].start - prev.at(-1).end < MERGE_GAP &&
      fits([...prev, ...piece], o);
    if (joinable) prev.push(...piece);
    else groups.push([...piece]);
  }

  const cues = groups.map((g) => ({
    start: g[0].start,
    end: g.at(-1).end,
    lines: layoutLines(textOf(g), o) ?? [textOf(g)],
    words: g.map((w) => ({ ...w })),
  }));
  // Extend holds into the silence after each cue for min hold and reading speed; never overlap the next cue.
  cues.forEach((cue, i) => {
    const limit = i + 1 < cues.length ? cues[i + 1].start : Infinity;
    const chars = cue.lines.join(" ").length;
    const want = Math.max(cue.end, cue.start + o.minHold, cue.start + chars / o.maxCps);
    cue.end = r3(Math.min(want, limit, cue.start + o.maxHold));
    cue.start = r3(cue.start);
  });
  return cues;
}

// A known sentence spread over its narration span by character weight.
export function wordsFromText(text, start, end) {
  const parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? spreadByWeight(parts, Number(start), Number(end)) : [];
}

export const cuesFromText = (text, start, end, options = {}) => cuesFromWords(wordsFromText(text, start, end), options);

function stamp(t, sep) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export const toSrt = (cues) =>
  cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.lines.join("\n")}\n`).join("\n");

export const toVtt = (cues) =>
  "WEBVTT\n\n" + cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.lines.join("\n")}\n`).join("\n");

export const toJson = (cues) => JSON.stringify(cues, null, 2) + "\n";

export function captionLint(cues, options = {}) {
  const o = { ...CAPTION_DEFAULTS, ...options };
  const findings = [];
  const add = (rule, i, evidence, hint) => findings.push({ rule, status: "fail", evidence: `cue ${i + 1}: ${evidence}`, hint, cue: i });
  cues.forEach((c, i) => {
    const hold = c.end - c.start;
    const chars = c.lines.join(" ").length;
    c.lines.forEach((line) => {
      if (line.length > o.maxChars) add("caption.chars-per-line", i, `${line.length} chars > ${o.maxChars} ("${line}")`, `Re-chunk: at most ${o.maxChars} characters per line.`);
    });
    if (c.lines.length > o.maxLines) add("caption.lines", i, `${c.lines.length} lines > ${o.maxLines}`, `Split the cue: at most ${o.maxLines} lines.`);
    if (hold > 0 && chars / hold > o.maxCps + 1e-9) add("caption.cps", i, `${(chars / hold).toFixed(1)} chars/s > ${o.maxCps}`, "Shorten the text or give the cue more time.");
    if (hold < o.minHold - 1e-9) add("caption.min-hold", i, `held ${hold.toFixed(2)} s < ${o.minHold} s`, "Merge with a neighbour or extend the hold.");
    if (hold > o.maxHold + 1e-9) add("caption.max-hold", i, `held ${hold.toFixed(2)} s > ${o.maxHold} s`, "Split the cue.");
    if (i > 0 && c.start < cues[i - 1].end - 1e-9) add("caption.overlap", i, `starts ${c.start} before cue ${i} ends ${cues[i - 1].end}`, "Cues must not overlap.");
  });
  return findings;
}

const WRITERS = { ".json": toJson, ".srt": toSrt, ".vtt": toVtt };

export function writeCaptions(cues, out) {
  const ext = extname(out).toLowerCase();
  const targets = WRITERS[ext] ? [out] : Object.keys(WRITERS).map((e) => out + e);
  for (const t of targets) writeText(t, WRITERS[extname(t).toLowerCase()](cues));
  return targets;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const opts = {};
  for (const [flag, key] of [["max-chars", "maxChars"], ["max-lines", "maxLines"], ["max-cps", "maxCps"], ["min-hold", "minHold"], ["max-hold", "maxHold"]]) {
    if (args[flag] !== undefined) opts[key] = Number(args[flag]);
  }
  if (!args.out || args.out === true) fail("--out captions.{json,srt,vtt} is required", 2);
  let cues;
  if (args.words) cues = cuesFromWords(readJson(args.words), opts);
  else if (args.text) {
    if (args.start === undefined || args.end === undefined) fail("--text needs --start and --end", 2);
    cues = cuesFromText(readFileSync(args.text, "utf8"), Number(args.start), Number(args.end), opts);
  } else fail("--words transcript.json or --text file is required", 2);
  const files = writeCaptions(cues, args.out);
  const findings = captionLint(cues, opts);
  const ok = findings.length === 0;
  if (args.json) process.stdout.write(JSON.stringify({ ok, cues: cues.length, files, findings }) + "\n");
  else {
    process.stdout.write(`${cues.length} cues → ${files.join(", ")}\n`);
    for (const f of findings) process.stdout.write(`  ${f.rule}: ${f.evidence}\n`);
  }
  process.exit(ok ? 0 : 1);
}
