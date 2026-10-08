// Ad craft rules (docs/research/ads-and-tutorials.md, ad rules 1, 3, 5, 7, 8, 9, 10)
// measured on the rendered PNG sequence plus plan.copy.
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ffmpeg } from "../lib/ffmpeg.mjs";
import { join } from "node:path";
import { loadSharp } from "../lib/browser.mjs";
import { finding, result, skip, isStill, isBumper, compositions, captionLines, readCaptionCues, words, cli, isMain } from "./common.mjs";

const GATE = "ad-lint";
const FIRST_CHANGE_S = 0.5;
const CHANGE_MIN = 0.01;
const EMPTY_STD = 0.02;
const FLASH_DELTA = 0.1;
const FLASH_DARK_MAX = 0.8;
const FLASH_MAX = 3;
const STATIC_MAX = 0.005;
const SMALL_W = 64;

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i / 255));

// Per frame: 64-px-wide RGB, gamma luma std-dev, mean relative luminance of the central 50% box.
export async function analyzeFrame(path) {
  const sharp = loadSharp();
  const { data, info } = await sharp(path).resize({ width: SMALL_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  let sum = 0, sum2 = 0, center = 0, centerN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sum += luma;
      sum2 += luma * luma;
      if (x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4) {
        center += 0.2126 * LIN[data[i]] + 0.7152 * LIN[data[i + 1]] + 0.0722 * LIN[data[i + 2]];
        centerN++;
      }
    }
  }
  const n = w * h;
  return { pixels: data, std: Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)), lum: centerN ? center / centerN : sum / n };
}

export async function analyzeFrames(files, concurrency = 8) {
  const out = new Array(files.length);
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = await Promise.all(files.slice(i, i + concurrency).map(analyzeFrame));
    batch.forEach((f, k) => (out[i + k] = f));
  }
  return out;
}

export function frameDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return n ? s / (n * 255) : 0;
}

// Opposing luminance transitions (≥ 10%, darker side < 0.8) found with hysteresis;
// returns the largest count inside any 1 s window.
export function maxFlashes(lums, fps) {
  const events = [];
  let lo = lums[0], hi = lums[0], dir = 0;
  for (let i = 1; i < lums.length; i++) {
    const L = lums[i];
    if (dir !== 1) lo = Math.min(lo, L);
    if (dir !== -1) hi = Math.max(hi, L);
    if (dir !== 1 && L - lo >= FLASH_DELTA && lo < FLASH_DARK_MAX) {
      events.push(i / fps);
      dir = 1;
      hi = L;
    } else if (dir !== -1 && hi - L >= FLASH_DELTA && L < FLASH_DARK_MAX) {
      events.push(i / fps);
      dir = -1;
      lo = L;
    }
  }
  let best = 0;
  for (let i = 0, j = 0; j < events.length; j++) {
    while (events[j] - events[i] >= 1) i++;
    best = Math.max(best, j - i + 1);
  }
  return { max: best, events };
}

export function lintSequence(frames, { fps, bumper = false, target } = {}) {
  const out = [];
  const ev = (o) => ({ target, ...o });
  const f0 = frames[0];

  const window = Math.min(frames.length - 1, Math.floor(FIRST_CHANGE_S * fps + 1e-9));
  let firstIdx = null;
  for (let i = 1; i < frames.length; i++) {
    if (frameDiff(f0.pixels, frames[i].pixels) > CHANGE_MIN) {
      firstIdx = i;
      break;
    }
  }
  const firstChange = firstIdx === null ? null : Number((firstIdx / fps).toFixed(3));
  const early = firstIdx !== null && firstIdx <= window;
  out.push(finding("ad.first-change", early ? "pass" : "fail", ev({ measured: firstChange, expected: `<= ${FIRST_CHANGE_S} s (mean pixel diff > ${CHANGE_MIN})` })));

  out.push(finding("ad.empty-start", f0.std > EMPTY_STD ? "pass" : "fail", ev({ measured: Number(f0.std.toFixed(4)), expected: `luma std-dev > ${EMPTY_STD} at t=0` })));

  const flashes = maxFlashes(frames.map((f) => f.lum), fps);
  out.push(finding("ad.flash", flashes.max > FLASH_MAX ? "fail" : "pass", ev({ measured: flashes.max, expected: `<= ${FLASH_MAX} opposing changes per 1 s`, at: flashes.events.slice(0, 12).map((t) => Number(t.toFixed(3))) })));

  const hold = bumper ? 2 : 1.5;
  const holdFrames = Math.round(hold * fps);
  if (frames.length <= holdFrames) {
    out.push(finding("ad.end-card", "skip", ev({ reason: `sequence shorter than the ${hold} s hold` })));
  } else {
    let max = 0, at = null;
    for (let i = frames.length - holdFrames; i < frames.length; i++) {
      const d = frameDiff(frames[i - 1].pixels, frames[i].pixels);
      if (d > max) [max, at] = [d, i / fps];
    }
    out.push(finding("ad.end-card", max < STATIC_MAX ? "pass" : "fail", ev({ measured: { maxDiff: Number(max.toFixed(4)), at }, expected: `last ${hold} s static (diff < ${STATIC_MAX})` })));
  }
  return out;
}

export function lintDuration(duration, { bumper = false, vertical = false, target } = {}) {
  const ev = (expected) => ({ target, measured: Number(duration.toFixed(3)), expected });
  if (bumper) return [finding("ad.duration", Math.abs(duration - 6) <= 0.1 ? "pass" : "fail", ev("6 ± 0.1 s bumper"))];
  if (duration > 60) return [finding("ad.duration", "fail", ev("<= 60 s for paid"))];
  const [min, max] = vertical ? [6, 15] : [6, 30];
  return [finding("ad.duration", duration < min || duration > max ? "warn" : "pass", ev(`${min}–${max} s`))];
}

export function lintCopy(copy = {}, { bumper = false, cues = null } = {}) {
  const out = [];
  const n = words(copy.headline).length;
  if (!n) out.push(finding("ad.headline-words", "fail", { measured: 0, expected: "a headline in plan.copy.headline" }));
  else out.push(finding("ad.headline-words", n > 7 ? "fail" : bumper && n > 5 ? "warn" : "pass", { measured: n, expected: bumper ? "<= 5 words (bumper), <= 7" : "<= 7 words", headline: copy.headline }));
  out.push(finding("ad.cta", String(copy.cta ?? "").trim() ? "pass" : "fail", { measured: copy.cta ?? null, expected: "plan.copy.cta" }));
  for (const [i, cue] of (cues ?? []).entries()) {
    const lines = captionLines(cue.text);
    const long = lines.filter((l) => l.length > 42);
    if (long.length) out.push(finding("ad.caption-line", "fail", { cue: i, measured: long.map((l) => l.length), expected: "<= 42 chars per line", text: cue.text }));
    if (lines.length > 2) out.push(finding("ad.caption-lines", "fail", { cue: i, measured: lines.length, expected: "<= 2 lines", text: cue.text }));
  }
  return out;
}

const frameNum = (f) => Number(f.match(/(\d+)\.png$/i)?.[1] ?? 0);

export function frameFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  const pngs = readdirSync(dir).filter((f) => /\.png$/i.test(f) && !/^sheet/i.test(f));
  const seq = pngs.filter((f) => /^frame[_-]?\d+\.png$/i.test(f));
  return (seq.length ? seq : pngs).sort((a, b) => frameNum(a) - frameNum(b) || a.localeCompare(b)).map((f) => join(dir, f));
}

function framesDir(ctx, name, first) {
  if (ctx.frames) return first ? ctx.frames : null;
  return ctx.stage === "dist" ? join(ctx.runDir, "dist", name, "frames") : join(ctx.runDir, "proof", name);
}

// deliver.mjs drops the PNG sequence after encoding; at dist the delivered mp4
// is the truth, so the frames are extracted from it at the analysis size.
function framesFromVideo(ctx, name, fps) {
  const dir = join(ctx.runDir, "dist", name);
  if (!existsSync(dir)) return null;
  const mp4 = readdirSync(dir).find((f) => /\.(mp4|webm|mov)$/i.test(f));
  if (!mp4) return null;
  const out = mkdtempSync(join(tmpdir(), "compositor-adlint-"));
  try {
    ffmpeg(["-y", "-i", join(dir, mp4), "-vf", `fps=${fps},scale=64:-2`, join(out, "frame_%06d.png")]);
  } catch {
    rmSync(out, { recursive: true, force: true });
    return null;
  }
  return out;
}

export async function run(ctx) {
  const mode = ctx.mode ?? ctx.plan?.mode;
  if (mode !== "ad") return skip(GATE, `mode ${mode ?? "unknown"} is not ad`);
  const plan = ctx.plan ?? {};
  const findings = [];
  const motion = compositions(plan).filter((c) => !isStill(c, ctx.targets?.[c.target]));
  const anyBumper = motion.some((c) => isBumper(c.target, ctx.targets?.[c.target], c));

  let cues = null;
  if (plan.audio?.captions) {
    const path = join(ctx.runDir, plan.audio.captions);
    if (existsSync(path)) cues = readCaptionCues(path);
    else findings.push(finding("ad.caption-line", "skip", { reason: `captions file ${plan.audio.captions} not found` }));
  }
  findings.push(...lintCopy(plan.copy, { bumper: anyBumper, cues }));

  for (const [k, comp] of motion.entries()) {
    const name = comp.target;
    const target = ctx.targets?.[name] ?? {};
    const fps = comp.fps ?? target.fps ?? 30;
    const bumper = isBumper(name, target, comp);
    const width = target.width ?? comp.width, height = target.height ?? comp.height;
    const vertical = height > width || /-ad$/.test(name ?? "");
    let frameSrc = framesDir(ctx, name, k === 0);
    let tmpFrames = null;
    if (ctx.stage === "dist" && !ctx.frames && !existsSync(frameSrc)) { tmpFrames = framesFromVideo(ctx, comp.name ?? name, fps); frameSrc = tmpFrames ?? frameSrc; }
    const files = frameFiles(frameSrc);
    const expected = comp.duration ? Math.round(comp.duration * fps) : null;
    const full = files.length > 1 && (expected === null || Math.abs(files.length - expected) <= Math.max(2, 0.05 * expected));
    const duration = full ? files.length / fps : comp.duration;
    if (duration) findings.push(...lintDuration(duration, { bumper, vertical, target: name }));
    else findings.push(finding("ad.duration", "skip", { target: name, reason: "no duration in plan and no frame sequence" }));
    if (!full) {
      findings.push(finding("ad.frames", "skip", { target: name, reason: files.length ? `${files.length} frames is not a full sequence (${expected} expected)` : "no rendered frame sequence" }));
      continue;
    }
    findings.push(...lintSequence(await analyzeFrames(files), { fps, bumper, target: name }));
    if (tmpFrames) rmSync(tmpFrames, { recursive: true, force: true });
  }
  return result(GATE, findings);
}

if (isMain(import.meta.url)) await cli(run);
