#!/usr/bin/env node
// Environment check for compositor: what each mode needs, what is missing, how to fix it.
//   node doctor.mjs [--json] [--quiet]   (quiet: print only when something required is missing)
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (bin, args = ["--version"]) => { const r = spawnSync(bin, args, { encoding: "utf8" }); return r.status === 0 ? (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 60) : null; };

export function doctor() {
  const checks = [
    { id: "node", required: true, ok: Number(process.versions.node.split(".")[0]) >= 22, detail: `node ${process.versions.node}`, fix: "Node ≥ 22" },
    { id: "deps", required: true, ok: existsSync(join(PLUGIN, "node_modules", "culori")), detail: existsSync(join(PLUGIN, "node_modules")) ? "node_modules present" : "node_modules missing", fix: `cd ${PLUGIN} && pnpm install` },
    { id: "hyperframes", required: true, ok: Boolean(has("hyperframes")), detail: has("hyperframes") ?? "not on PATH", fix: "npm i -g hyperframes" },
    { id: "ffmpeg", required: true, ok: Boolean(has("ffmpeg", ["-version"])), detail: has("ffmpeg", ["-version"]) ?? "missing", fix: "install ffmpeg" },
    { id: "chromium", required: true, ok: ["/usr/bin/chromium", "/usr/bin/google-chrome"].some(existsSync) || existsSync(join(process.env.HOME ?? "", ".cache/hyperframes/chrome")), detail: "chromium or hyperframes chrome-headless-shell", fix: "install chromium or run `npx hyperframes browser install`" },
    { id: "magick", required: false, ok: Boolean(has("magick", ["-version"])), detail: "contact sheets, carousel PDFs", fix: "install imagemagick" },
    { id: "uv", required: false, ok: Boolean(has("uv")), detail: "explain mode (Manim)", fix: "install uv, then scripts/explain/run.sh setup" },
    { id: "manim-env", required: false, ok: existsSync(join(process.env.COMPOSITOR_DATA ?? join(process.env.HOME ?? "", ".claude/plugins/data/compositor"), "manim", "bin", "python")), detail: "explain mode env", fix: "bash scripts/explain/run.sh setup" },
    { id: "kokoro", required: false, ok: Boolean(has("hyperframes", ["tts", "--list"])), detail: "local TTS for promo/guide", fix: "first `hyperframes tts` downloads Kokoro-82M" },
  ];
  const missing = checks.filter((c) => c.required && !c.ok);
  return { ok: missing.length === 0, checks, missing: missing.map((c) => c.id) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const r = doctor();
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else if (!args.quiet || !r.ok) for (const c of r.checks) if (!args.quiet || (c.required && !c.ok)) process.stdout.write(`${c.ok ? "ok " : c.required ? "MISSING" : "opt"}  ${c.id.padEnd(11)} ${c.detail}${c.ok ? "" : `  → ${c.fix}`}\n`);
  process.exit(r.ok ? 0 : 1);
}
