// EBU R128 (ffmpeg ebur128) of every delivered file with an audio stream.
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { probe, loudness } from "../lib/ffmpeg.mjs";
import { walk } from "../lib/fs.mjs";
import { finding, result, skip, cli, isMain } from "./common.mjs";

const GATE = "loudness";
const AV_EXT = /\.(mp4|m4v|mov|webm|mkv|wav|m4a|aac|mp3)$/i;

// −14 LUFS for social mixes, −16 for narration-only deliverables (docs/research/ads-and-tutorials.md).
export function loudnessTarget(ctx, target) {
  const t = target?.loudness ?? {};
  const narrationOnly = Boolean(ctx.plan?.audio?.vo) && !ctx.plan?.audio?.music && ["guide", "explain"].includes(ctx.mode ?? ctx.plan?.mode);
  return { lufs: t.lufs ?? t.integrated ?? (narrationOnly ? -16 : -14), truePeak: t.truePeak ?? t.tp ?? -1, lra: t.lra ?? 11 };
}

export function judgeLoudness(m, want, file) {
  const out = [];
  const ev = (measured, expected) => ({ file, measured, expected });
  if (m.integrated == null || !Number.isFinite(m.integrated)) out.push(finding("loudness.integrated", "fail", ev(m.integrated, `${want.lufs} ±1 LUFS`)));
  else if (Math.abs(m.integrated - want.lufs) > 1) out.push(finding("loudness.integrated", "fail", ev(m.integrated, `${want.lufs} ±1 LUFS`)));
  if (m.truePeak != null && m.truePeak > want.truePeak) out.push(finding("loudness.true-peak", "fail", ev(m.truePeak, `<= ${want.truePeak} dBTP`)));
  if (m.range != null && m.range > want.lra) out.push(finding("loudness.lra", "warn", ev(m.range, `<= ${want.lra} LU`)));
  return out;
}

export async function run(ctx) {
  if (ctx.stage !== "dist") return skip(GATE, "loudness runs on dist only");
  const dist = join(ctx.runDir, "dist");
  if (!existsSync(dist)) return skip(GATE, "dist/ does not exist");
  const findings = [];
  let measured = 0;
  for (const path of walk(dist, (rel) => AV_EXT.test(rel) && !rel.split("/").some((d) => d === "frames" || d === "media"))) {
    const rel = relative(ctx.runDir, path);
    let info;
    try {
      info = probe(path);
    } catch (e) {
      if (/ENOENT/.test(e.message)) return skip(GATE, "ffprobe not available");
      continue;
    }
    if (!info.audio) continue;
    const name = relative(dist, path).split("/")[0];
    findings.push(...judgeLoudness(loudness(path), loudnessTarget(ctx, ctx.targets?.[name]), rel));
    measured++;
  }
  if (!measured) return skip(GATE, "no delivered file has an audio stream");
  return result(GATE, findings, { checked: measured });
}

if (isMain(import.meta.url)) await cli(run);
