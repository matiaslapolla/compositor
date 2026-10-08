#!/usr/bin/env node
// Run trace: compositor/runs/<slug>/run.json. Every run is an eval row.
//   node run.mjs init --run <dir> --mode social --brief "…" --brand compositor/brand.json [--eval 3]
//   node run.mjs record --run <dir> --key gates.proof --file gates.json | --value '{"…"}'
//   node run.mjs usage --run <dir> --mark start|end
//   node run.mjs verdict --run <dir> publish|reject [--note "…"]
//   node run.mjs list --root compositor/runs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, writeText } from "../lib/fs.mjs";
import { usage as hfUsage } from "../lib/hyperframes.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

export function initRun({ runDir, mode, brief, brandPath, evalRow, slug }) {
  const path = join(runDir, "run.json");
  const existing = readJson(path, null);
  const brand = brandPath && existsSync(brandPath) ? readFileSync(brandPath, "utf8") : null;
  const run = {
    version: 1,
    slug: slug ?? runDir.split("/").at(-1),
    mode,
    brief: brief ?? existing?.brief ?? null,
    brandHash: brand ? sha(brand) : existing?.brandHash ?? null,
    brandName: brand ? JSON.parse(brand).identity?.name ?? null : existing?.brandName ?? null,
    eval: evalRow ? { row: Number(evalRow) } : existing?.eval ?? null,
    plan: existing?.plan ?? null,
    gates: existing?.gates ?? {},
    fixRounds: existing?.fixRounds ?? 0,
    director: existing?.director ?? null,
    usage: existing?.usage ?? {},
    verdict: existing?.verdict ?? null,
    note: existing?.note ?? null,
  };
  writeJson(path, run);
  if (brief) writeText(join(runDir, "brief.md"), brief.endsWith("\n") ? brief : brief + "\n");
  return run;
}

export function record(runDir, key, value) {
  const path = join(runDir, "run.json");
  const run = readJson(path);
  const parts = key.split(".");
  let o = run;
  for (const k of parts.slice(0, -1)) o = o[k] ??= {};
  o[parts.at(-1)] = value;
  writeJson(path, run);
  return run;
}

export function snapshotUsage(runDir, mark) {
  const u = hfUsage().data;
  const value = u?.status === "known" ? { session: u.session.usedPercent, weekly: u.weekly.usedPercent } : { unknown: true };
  const run = record(runDir, `usage.${mark}`, value);
  if (run.usage.start && run.usage.end && !run.usage.start.unknown && !run.usage.end.unknown) {
    record(runDir, "usage.sessionDelta", Number((run.usage.end.session - run.usage.start.session).toFixed(1)));
  }
  return value;
}

export function listRuns(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).map((d) => readJson(join(root, d, "run.json"), null)).filter(Boolean).map((r) => ({ slug: r.slug, mode: r.mode, verdict: r.verdict, fixRounds: r.fixRounds, gates: Object.fromEntries(Object.entries(r.gates ?? {}).map(([k, v]) => [k, v?.status ?? v])), director: r.director?.rating ?? null, eval: r.eval?.row ?? null, usage: r.usage?.sessionDelta ?? null }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === "list") { const rows = listRuns(resolve(args.root ?? "compositor/runs")); process.stdout.write(args.json ? JSON.stringify(rows, null, 2) : rows.map((r) => `${r.slug}\t${r.mode}\t${r.verdict ?? "-"}\tfix ${r.fixRounds}\t${Object.entries(r.gates).map(([k, v]) => `${k}:${v}`).join(" ")}`).join("\n") + "\n"); process.exit(0); }
  if (!args.run) fail("--run <runDir> is required", 2);
  const runDir = resolve(args.run);
  if (cmd === "init") { const r = initRun({ runDir, mode: args.mode, brief: args.brief, brandPath: args.brand && resolve(args.brand), evalRow: args.eval }); process.stdout.write(`${r.slug}: ${r.mode} (${r.brandName ?? "no brand"})\n`); }
  else if (cmd === "record") { if (!args.key) fail("--key is required", 2); const value = args.file ? readJson(resolve(args.file)) : args.value !== undefined ? safeParse(args.value) : fail("--file or --value", 2); record(runDir, args.key, value); }
  else if (cmd === "usage") { const v = snapshotUsage(runDir, args.mark ?? "start"); process.stdout.write(JSON.stringify(v) + "\n"); }
  else if (cmd === "verdict") { const v = args._[1]; if (!["publish", "reject"].includes(v)) fail("verdict must be publish or reject", 2); record(runDir, "verdict", v); if (args.note) record(runDir, "note", args.note); process.stdout.write(`${runDir.split("/").at(-1)}: ${v}\n`); }
  else fail("usage: run.mjs init|record|usage|verdict|list …", 2);
}
function safeParse(v) { try { return JSON.parse(v); } catch { return v; } }
