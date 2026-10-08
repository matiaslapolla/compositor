// One wrapper around the HyperFrames CLI so a flag change is one edit.
// Every call is local and free: telemetry, update checks, skills sync and
// vision captioning are off.
import { spawnSync } from "node:child_process";

export const HF_ENV = {
  HYPERFRAMES_NO_TELEMETRY: "1",
  HYPERFRAMES_NO_UPDATE_CHECK: "1",
  HYPERFRAMES_SKIP_SKILLS: "1",
};

export function hf(args, { cwd, json = false, quiet = true, timeoutMs = 20 * 60_000 } = {}) {
  const r = spawnSync("npx", ["--no-install", "hyperframes", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...HF_ENV, GEMINI_API_KEY: "", GOOGLE_API_KEY: "", OPENROUTER_API_KEY: "" },
    maxBuffer: 1 << 28,
    timeout: timeoutMs,
  });
  if (r.error?.code === "ETIMEDOUT") throw new Error(`hyperframes ${args[0]} timed out after ${Math.round(timeoutMs / 60_000)} min`);
  if (r.error) throw r.error;
  if (!quiet) process.stderr.write(r.stderr || "");
  if (json) {
    const text = r.stdout || "";
    const start = text.indexOf("{"), startArr = text.indexOf("[");
    const s = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
    try {
      return { status: r.status, data: JSON.parse(text.slice(s)), stderr: r.stderr };
    } catch {
      return { status: r.status, data: null, stdout: text, stderr: r.stderr };
    }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A render's wall time grows with its frame count (about 0.5 s a frame at 1080p on a 12-core
// machine), so its timeout is 2 s a frame, never under the default 20 min.
export const renderTimeoutMs = (frames) => Math.max(20 * 60_000, Math.ceil(frames ?? 0) * 2_000);

export const render = (composition, { out, format = "png-sequence", quality = "looks", fps, cwd, workers, frames, extra = [] } = {}) =>
  hf(
    [
      "render", "-c", composition, "--format", format, "-q", quality, "--no-browser-gpu", "--quiet",
      ...(fps ? ["-f", String(fps)] : []), ...(workers ? ["-w", String(workers)] : []), ...(out ? ["-o", out] : []), ...extra,
    ],
    { cwd, timeoutMs: renderTimeoutMs(frames) },
  );

export const snapshot = (composition, { at, out, cwd } = {}) =>
  hf(["snapshot", composition, "--describe", "false", ...(at ? ["--at", at.join(",")] : []), ...(out ? ["-o", out] : [])], { cwd });

export const check = (dir, { captionZone, at, strict = true, cwd } = {}) =>
  hf(
    [
      "check", dir, "--json", "--frame-check", ...(strict ? ["--strict"] : []),
      ...(captionZone ? ["--caption-zone", captionZone] : []), ...(at ? ["--at", at.join(",")] : []),
    ],
    { cwd, json: true },
  );

export const lint = (dir, { cwd } = {}) => hf(["lint", dir, "--json"], { cwd, json: true });

export const tts = (text, { out, voice = "af_heart", speed = 1, lang, cwd } = {}) =>
  hf(["tts", text, "-o", out, "-v", voice, "-s", String(speed), ...(lang ? ["-l", lang] : [])], { cwd });

export const transcribe = (media, { dir, engine = "auto", lang, model, cwd } = {}) =>
  hf(["transcribe", media, "-d", dir, "-e", engine, "--json", ...(lang ? ["-l", lang] : []), ...(model ? ["-m", model] : [])], { cwd, json: true });

export const usage = () => hf(["usage", "--json"], { json: true });
export const doctor = () => hf(["doctor", "--json"], { json: true });
