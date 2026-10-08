// Social mode: the headline fits the claim rule and a seamless loop closes.
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSharp } from "../lib/browser.mjs";
import { ffmpeg } from "../lib/ffmpeg.mjs";
import { finding, result, skip, cli, isMain, words, compositions } from "./common.mjs";

const GATE = "social-lint";
export const HEADLINE_MAX_WORDS = 7;
export const LOOP_MAX_DIFF = 0.02;

export function lintCopy(copy = {}) {
  const n = words(copy.headline).length;
  if (!n) return [finding("social.headline-words", "skip", { reason: "no plan.copy.headline" })];
  return [finding("social.headline-words", n <= HEADLINE_MAX_WORDS ? "pass" : "fail", { measured: n, expected: `≤ ${HEADLINE_MAX_WORDS}` })];
}

// Mean absolute difference between two PNGs at 64 px, 0..1.
export async function frameDiff(a, b) {
  const sharp = loadSharp();
  const [x, y] = await Promise.all([a, b].map((f) => sharp(f).resize(64, 64, { fit: "fill", kernel: "linear" }).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length / 255;
}

export async function loopFindings(file, { fps, duration }) {
  const dir = mkdtempSync(join(tmpdir(), "compositor-loop-"));
  try {
    const first = join(dir, "first.png"), last = join(dir, "last.png");
    ffmpeg(["-y", "-i", file, "-frames:v", "1", first]);
    ffmpeg(["-y", "-sseof", `-${(1 / fps).toFixed(4)}`, "-i", file, "-frames:v", "1", "-update", "1", last]);
    if (!existsSync(last)) ffmpeg(["-y", "-ss", String(Math.max(0, duration - 1 / fps)), "-i", file, "-frames:v", "1", last]);
    const diff = await frameDiff(first, last);
    return [finding("social.loop-seamless", diff <= LOOP_MAX_DIFF ? "pass" : "fail", { measured: Number(diff.toFixed(4)), expected: `first vs last frame diff ≤ ${LOOP_MAX_DIFF}`, file })];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function run(ctx) {
  const plan = ctx.plan ?? {};
  const findings = lintCopy(plan.copy);
  const seamless = plan.loop === "seamless" || /seamless/.test(plan.params?.loop ?? "") || plan.template === "social/claim";
  if (ctx.stage === "dist" && seamless) {
    for (const comp of compositions(plan)) {
      if (comp.kind !== "motion") continue;
      const dir = join(ctx.runDir, "dist", comp.name ?? comp.target);
      const mp4 = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".mp4")) : null;
      if (!mp4) { findings.push(finding("social.loop-seamless", "skip", { target: comp.target, reason: "no mp4 in dist" })); continue; }
      findings.push(...(await loopFindings(join(dir, mp4), { fps: comp.fps ?? 30, duration: comp.duration ?? 6 })).map((f) => ({ ...f, evidence: { target: comp.target, ...f.evidence } })));
    }
  } else if (seamless) findings.push(finding("social.loop-seamless", "skip", { reason: "measured on dist" }));
  return result(GATE, findings);
}

if (isMain(import.meta.url)) await cli(run);
