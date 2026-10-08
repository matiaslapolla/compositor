// Gate for explain mode: narration lint, Manim layout probe and background colour of the rendered video.
// Reads plan.explain = { episode, theme?, bounds?, video?, home? } (paths relative to the run dir).
// Rules: explain.narration (lint errors fail, warnings warn), explain.bounds (offscreen fails,
// overlap warns), explain.theme-bg (dominant background within ΔE 0.02 of theme BG).
import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readJson } from "../lib/fs.mjs";
import { deltaE } from "../lib/color.mjs";
import { probe } from "../lib/ffmpeg.mjs";
import { manimTheme } from "../brand/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN_SH = join(here, "..", "explain", "run.sh");
const BG_TOLERANCE = 0.02;
const SAMPLES = 5;

const finding = (rule, status, evidence, hint = "") => ({ rule, status, evidence, hint });

export function mapLint(rows) {
  if (!rows.length) return [finding("explain.narration", "pass", "no narration findings")];
  return rows.map((r) =>
    finding(
      "explain.narration",
      r.level === "error" ? "fail" : "warn",
      `${r.file}:${r.line}: ${r.message}`,
      "Shorten the sentence, use the glossary term, or write symbols in words; keep one idea per beat.",
    ),
  );
}

export function mapBounds(data) {
  const rows = Array.isArray(data) ? data : (data.findings ?? []);
  if (!rows.length) return [finding("explain.bounds", "pass", "no offscreen or overlapping mobjects")];
  return rows.map((r) => {
    const box = r.bbox?.map((v) => v.toFixed(2)).join(", ");
    const where = r.beat ? ` (beat ${r.beat})` : "";
    return r.issue === "offscreen"
      ? finding("explain.bounds", "fail", `${r.mobject} leaves the frame [${box}]${where}`, "Scale or move it inside the frame with a 0.3 margin; split the beat if it does not fit.")
      : finding("explain.bounds", "warn", `${r.mobject} overlaps ${r.with ?? "another text"} [${box}]${where}`, "Move one with next_to or arrange, or fade the first out before the second appears.");
  });
}

// Most frequent colour (4-bit buckets), averaged over the pixels in that bucket.
export function dominantColor(rgb) {
  const buckets = new Map();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += rgb[i];
    b.g += rgb[i + 1];
    b.b += rgb[i + 2];
    buckets.set(key, b);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const hex = [top.r, top.g, top.b].map((v) => Math.round(v / top.n).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

function sampleFrame(video, seconds) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-vf", "scale=96:54:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
  return r.status === 0 && r.stdout.length ? dominantColor(r.stdout) : null;
}

export function checkBackground(video, bg, { sample = sampleFrame, duration } = {}) {
  const span = duration ?? probe(video).duration;
  const colors = Array.from({ length: SAMPLES }, (_, i) => sample(video, (span * (i + 1)) / (SAMPLES + 1)));
  if (colors.some((c) => c === null)) return finding("explain.theme-bg", "skip", "ffmpeg could not decode sample frames");
  const worst = Math.max(...colors.map((c) => deltaE(c, bg)));
  return worst <= BG_TOLERANCE
    ? finding("explain.theme-bg", "pass", `dominant background within ΔE ${worst} of ${bg} over ${SAMPLES} frames`)
    : finding("explain.theme-bg", "fail", `dominant background ΔE ${worst} from theme BG ${bg} (${colors.join(", ")})`, "Render with --theme <run>/theme.json so COMPOSITOR_THEME is set; do not set camera.background_color in the episode.");
}

function runLint(episode, { theme, home }) {
  const args = ["lint", episode, "--json"];
  if (theme) args.push("--theme", theme);
  if (home) args.push("--home", home);
  const r = spawnSync("bash", [RUN_SH, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status === 0 || r.status === 1) {
    try {
      return { rows: JSON.parse(r.stdout) };
    } catch {
      /* fall through to the skip below */
    }
  }
  return { skip: (r.stderr || r.stdout || "run.sh lint failed").trim().split("\n").slice(-3).join(" | ") };
}

const inRun = (runDir, p) => (isAbsolute(p) ? p : resolve(runDir, p));
const firstExisting = (paths) => paths.find((p) => p && existsSync(p));

function findVideo(runDir, stage) {
  const dirs = [join(runDir, stage === "dist" ? "dist" : "proof"), join(runDir, "proof"), join(runDir, "dist")];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const mp4 = readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort()[0];
    if (mp4) return join(dir, mp4);
  }
  return null;
}

export async function run(ctx, { lint = runLint } = {}) {
  const { runDir, stage = "proof", plan = {}, brand } = ctx;
  const ex = plan.explain ?? {};
  const findings = [];

  const episode = ex.episode ? inRun(runDir, ex.episode) : null;
  const theme = ex.theme ? inRun(runDir, ex.theme) : firstExisting([join(runDir, "proof", "theme.json"), join(runDir, "theme.json")]);
  if (!episode || !existsSync(episode)) findings.push(finding("explain.narration", "skip", "plan.explain.episode missing or not on disk"));
  else {
    const result = lint(episode, { theme, home: ex.home ? inRun(runDir, ex.home) : undefined });
    if (result.skip) findings.push(finding("explain.narration", "skip", `lint not run: ${result.skip}`, "Run scripts/explain/run.sh setup."));
    else findings.push(...mapLint(result.rows));
  }

  const boundsPath = firstExisting([ex.bounds && inRun(runDir, ex.bounds), join(runDir, "proof", "bounds.json"), join(runDir, "dist", "bounds.json")]);
  if (!boundsPath) findings.push(finding("explain.bounds", "skip", "no bounds.json; the episode does not use BoundsMixin or has not been rendered"));
  else findings.push(...mapBounds(readJson(boundsPath)));

  const video = ex.video ? inRun(runDir, ex.video) : findVideo(runDir, stage);
  const bg = theme ? readJson(theme).BG : brand ? manimTheme(brand).BG : null;
  if (!video || !existsSync(video)) findings.push(finding("explain.theme-bg", "skip", "no rendered mp4 to sample"));
  else if (!bg) findings.push(finding("explain.theme-bg", "skip", "no theme.json or brand to take BG from"));
  else if (spawnSync("ffmpeg", ["-version"]).status !== 0) findings.push(finding("explain.theme-bg", "skip", "ffmpeg not available"));
  else findings.push(checkBackground(video, bg));

  const measured = findings.filter((f) => f.status !== "skip");
  const status = findings.some((f) => f.status === "fail") ? "fail" : findings.some((f) => f.status === "warn") ? "warn" : measured.length ? "pass" : "skip";
  return { gate: "explain-lint", status, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseArgs, fail } = await import("../lib/args.mjs");
  const args = parseArgs(process.argv.slice(2));
  const runDir = args._[0] ?? args.run;
  if (!runDir) fail("usage: explain-lint.mjs <runDir> [--stage proof|dist] [--json]", 2);
  const plan = readJson(join(runDir, "plan.json"), {});
  const brandPath = firstExisting([join(runDir, "..", "..", "brand.json")]);
  const result = await run({ runDir: resolve(runDir), stage: args.stage ?? "proof", plan, brand: brandPath ? readJson(brandPath) : undefined, targets: plan.targets });
  if (args.json) process.stdout.write(JSON.stringify(result) + "\n");
  else {
    process.stdout.write(`explain-lint: ${result.status}\n`);
    for (const f of result.findings) process.stdout.write(`  ${f.status.padEnd(4)} ${f.rule}: ${f.evidence}\n`);
  }
  process.exit(result.status === "fail" ? 1 : 0);
}
