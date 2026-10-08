#!/usr/bin/env node
// Full render and encode per target: png-sequence → ffmpeg per platform preset (+ audio, loudnorm) → dist/<target>/.
//   node deliver.mjs --run <runDir> [--only reels,ig-square] [--formats mp4,webm] [--keep-frames] [--json]
import { existsSync, readdirSync, rmSync, copyFileSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, fail, list } from "../lib/args.mjs";
import { readJson, writeText, ensureDir } from "../lib/fs.mjs";
import { ffmpeg, probe, loudnormFilter, pngSequenceInfo } from "../lib/ffmpeg.mjs";
import { render } from "../lib/hyperframes.mjs";
import { target as targetOf, DEFAULT_FORMATS, AUDIO_DEFAULT } from "../targets/presets.mjs";
import { encodeArgs, stillArgs, encodePlan } from "../targets/encode.mjs";

export function renderFrames(runDir, comp) {
  const dir = resolve(runDir, comp.dir ?? comp.file.replace(/\/index\.html$/, ""));
  const out = ensureDir(join(runDir, "dist", comp.name ?? comp.target, "frames"));
  for (const f of readdirSync(out)) rmSync(join(out, f), { recursive: true, force: true });
  const r = render("index.html", { out, format: "png-sequence", fps: comp.fps, cwd: dir, quality: "looks", frames: (comp.duration ?? 0) * (comp.fps ?? 30) });
  const info = existsSync(out) && readdirSync(out).some((f) => f.endsWith(".png")) ? pngSequenceInfo(out) : null;
  if (r.status !== 0 || !info) throw new Error(`render failed for ${comp.target} (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
  return { dir: out, ...info };
}

export function deliverComposition(runDir, comp, plan, { formats, keepFrames = false, background } = {}) {
  const t = targetOf(comp.target);
  const dist = ensureDir(join(runDir, "dist", comp.name ?? comp.target));
  const seq = renderFrames(runDir, comp);
  const files = [];
  const audio = plan.audio?.mix ? resolve(runDir, plan.audio.mix) : plan.audio?.vo ? resolve(runDir, plan.audio.vo) : null;
  const bg = background ?? (comp.kind === "still" ? null : plan.background ?? null);
  if (comp.kind === "still") {
    for (const fmt of formats ?? DEFAULT_FORMATS.still) {
      const out = join(dist, `${comp.name ?? comp.target}.${fmt}`);
      ffmpeg(stillArgs({ input: join(seq.dir, seq.first), output: out, background: bg }));
      files.push(out);
    }
  } else {
    for (const fmt of formats ?? DEFAULT_FORMATS.motion) {
      const out = join(dist, `${comp.target}.${fmt}`);
      if (fmt === "mp4") {
        const ep = encodePlan(comp.target, { durationS: comp.duration, audio: Boolean(audio) });
        const ln = audio && existsSync(audio) ? loudnormFilter(audio, { I: t.loudness?.lufs ?? AUDIO_DEFAULT.lufs, TP: t.loudness?.truePeak ?? AUDIO_DEFAULT.truePeak, LRA: t.loudness?.lra ?? AUDIO_DEFAULT.lra }) : null;
        const base = { input: join(seq.dir, seq.pattern), output: out, fps: comp.fps, width: { w: comp.width, h: comp.height }, background: bg, audio: audio && existsSync(audio) ? audio : null, loudnormFilter: ln, profile: ep.profile, audioKbps: ep.audioKbps };
        if (ep.bitrateKbps) {
          const passlog = join(dist, "x264-pass");
          ffmpeg(encodeArgs("mp4", { ...base, bitrateKbps: ep.bitrateKbps, maxrateKbps: ep.maxrateKbps, pass: 1, passlog }));
          ffmpeg(encodeArgs("mp4", { ...base, bitrateKbps: ep.bitrateKbps, maxrateKbps: ep.maxrateKbps, pass: 2, passlog }));
          for (const f of readdirSync(dist)) if (f.startsWith("x264-pass")) rmSync(join(dist, f));
        } else ffmpeg(encodeArgs("mp4", { ...base, crf: ep.crf }));
      } else if (fmt === "gif") {
        const palette = join(dist, "palette.png");
        ffmpeg(encodeArgs("gif-palette", { input: join(seq.dir, seq.pattern), output: palette, fps: comp.fps, width: { w: comp.width, h: comp.height }, gifWidth: Math.min(comp.width, 720) }));
        ffmpeg(encodeArgs("gif", { input: join(seq.dir, seq.pattern), output: { palette, file: out }, fps: comp.fps, width: { w: comp.width, h: comp.height }, gifWidth: Math.min(comp.width, 720) }));
        rmSync(palette);
      } else ffmpeg(encodeArgs(fmt, { input: join(seq.dir, seq.pattern), output: out, fps: comp.fps, width: { w: comp.width, h: comp.height }, background: bg }));
      files.push(out);
    }
    // Sidecar captions travel with the video.
    for (const key of ["captionsSrt", "captionsVtt"]) if (plan.audio?.[key] && existsSync(resolve(runDir, plan.audio[key]))) { const dest = join(dist, `${comp.target}${plan.audio[key].match(/\.\w+$/)[0]}`); copyFileSync(resolve(runDir, plan.audio[key]), dest); files.push(dest); }
  }
  if (!keepFrames) rmSync(seq.dir, { recursive: true, force: true });
  return { target: comp.target, kind: comp.kind, files, frames: seq.count };
}

export function readme(runDir, plan, delivered) {
  const rows = [];
  for (const d of delivered) for (const f of d.files) {
    let info = null;
    try { info = /\.(mp4|webm|mov|gif|webp|png|jpg)$/i.test(f) ? probe(f) : null; } catch {}
    const size = (statSync(f).size / 1024).toFixed(0);
    const dims = info?.video ? `${info.video.width}×${info.video.height}` : "";
    const dur = info?.video && d.kind !== "still" ? `${info.duration.toFixed(2)} s @ ${Math.round(info.video.fps)} fps` : "";
    const codec = info?.video ? `${info.video.codec}${info.video.pixFmt ? ` ${info.video.pixFmt}` : ""}${info.audio ? ` + ${info.audio.codec}` : ""}` : "";
    rows.push(`| ${d.target} | ${basename(f)} | ${dims} | ${dur} | ${codec} | ${size} KiB |`);
  }
  const text = `# ${plan.title ?? plan.slug ?? "compositor run"}\n\nMode: ${plan.mode ?? "?"} · template: ${plan.template ?? "?"} · canvas: ${plan.canvas ?? "?"}\n\n| target | file | size | duration | codec | bytes |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n\nGates: see \`gates.json\`. Re-render: \`node <plugin>/scripts/render/deliver.mjs --run ${runDir}\`.\n`;
  writeText(join(runDir, "dist", "README.md"), text);
  return text;
}

export function deliverRun(runDir, { only, formats, keepFrames } = {}) {
  const plan = readJson(join(runDir, "plan.json"));
  const comps = (plan.compositions ?? []).filter((c) => !only?.length || only.includes(c.target));
  if (!comps.length) fail("plan.json has no compositions to deliver", 2);
  const delivered = comps.map((c) => deliverComposition(runDir, c, plan, { formats, keepFrames }));
  // Carousel pages: one PDF per target from the slide PNGs, in order.
  const pages = comps.filter((c) => c.page);
  for (const target of new Set(pages.map((c) => c.target))) {
    const slides = pages.filter((c) => c.target === target).sort((a, b) => a.slide - b.slide).map((c) => join(runDir, "dist", c.name, `${c.name}.png`)).filter(existsSync);
    if (!slides.length) continue;
    const pdf = join(ensureDir(join(runDir, "dist", target)), `${target}.pdf`);
    const r = spawnSync("magick", [...slides, "-density", "150", pdf], { encoding: "utf8" });
    if (r.status === 0) delivered.push({ target, kind: "page", files: [pdf], frames: slides.length });
  }
  readme(runDir, plan, delivered);
  return delivered;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run) fail("--run <runDir> is required", 2);
  const r = deliverRun(resolve(args.run), { only: list(args.only), formats: args.formats ? list(args.formats) : undefined, keepFrames: Boolean(args["keep-frames"]) });
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2));
  else for (const d of r) process.stdout.write(`${d.target}\t${d.frames} frames\t${d.files.map((f) => basename(f)).join(", ")}\n`);
}
