#!/usr/bin/env node
// Proof frames before the full render: hyperframes snapshot per target, plus a contact sheet.
//   node proof.mjs --run <runDir> [--frames 5] [--at 0.5,2,4] [--only ig-square] [--json]
// Writes <runDir>/proof/<target>/*.png and <runDir>/proof/sheet.png (ImageMagick when present).
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, fail, list } from "../lib/args.mjs";
import { readJson, ensureDir } from "../lib/fs.mjs";
import { hf } from "../lib/hyperframes.mjs";

export function proofComposition(runDir, comp, { frames = 5, at } = {}) {
  const dir = resolve(runDir, comp.dir ?? comp.file.replace(/\/index\.html$/, ""));
  const out = ensureDir(join(runDir, "proof", comp.name ?? comp.target));
  for (const f of readdirSync(out)) if (f.endsWith(".png")) rmSync(join(out, f));
  const times = comp.kind === "still" ? [0] : at ?? null;
  const args = ["snapshot", dir, "--describe", "false", "--no-browser-gpu", "-o", out, ...(times ? ["--at", times.join(","), "--no-end"] : ["--frames", String(frames)])];
  const r = hf(args, { timeoutMs: 5 * 60_000 });
  const pngs = readdirSync(out).filter((f) => f.endsWith(".png")).sort();
  if (r.status !== 0 || !pngs.length) throw new Error(`snapshot failed for ${comp.target} (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
  return { target: comp.target, dir: out, frames: pngs.map((f) => join(out, f)) };
}

export function contactSheet(runDir, results, { out = join(runDir, "proof", "sheet.png"), tile = 480 } = {}) {
  const files = results.flatMap((r) => r.frames);
  if (!files.length) return null;
  const perRow = Math.max(...results.map((r) => r.frames.length));
  const montage = spawnSync("magick", ["montage", ...files, "-tile", `${perRow}x`, "-geometry", `${tile}x${tile}+6+6`, "-background", "#202020", "-fill", "#dddddd", "-pointsize", "14", "-label", "%t", out], { encoding: "utf8" });
  return montage.status === 0 ? out : null;
}

export function proofRun(runDir, { frames, at, only } = {}) {
  const plan = readJson(join(runDir, "plan.json"));
  const comps = (plan.compositions ?? []).filter((c) => !only?.length || only.includes(c.target));
  if (!comps.length) fail("plan.json has no compositions to proof", 2);
  const results = comps.map((c) => proofComposition(runDir, c, { frames, at }));
  const sheet = contactSheet(runDir, results);
  return { results, sheet };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run) fail("--run <runDir> is required", 2);
  const r = proofRun(resolve(args.run), { frames: args.frames ? Number(args.frames) : undefined, at: args.at ? list(args.at).map(Number) : undefined, only: list(args.only) });
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2));
  else { for (const x of r.results) process.stdout.write(`${x.target}\t${x.frames.length} frames\t${x.dir}\n`); if (r.sheet) process.stdout.write(`sheet\t${r.sheet}\n`); }
}
