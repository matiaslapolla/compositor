// Aggregator: runs the gates that apply to a mode and stage, writes gates.json,
// exits 1 on any fail. The exit code is the verdict.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, list } from "../lib/args.mjs";
import { writeJson } from "../lib/fs.mjs";
import { finding, worst, contextFromArgs, isMain } from "./common.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MODULES = {
  check: ["check.mjs"],
  palette: ["palette.mjs"],
  seams: ["seams.mjs"],
  probe: ["probe.mjs"],
  loudness: ["loudness.mjs"],
  "ad-lint": ["ad-lint.mjs"],
  "guide-lint": ["guide-lint.mjs"],
  "explain-lint": ["explain-lint.mjs"],
  "logo-gate": ["logo-gate.mjs", "../mark/logo-gate.mjs"],
  offline: ["offline.mjs"],
  "social-lint": ["social-lint.mjs"],
  "promo-lint": ["promo-lint.mjs"],
};
const MODE_GATES = { social: ["social-lint"], ad: ["ad-lint"], promo: ["promo-lint"], guide: ["guide-lint"], explain: ["explain-lint"], mark: ["logo-gate"] };
// mark and explain have no HyperFrames project; their mode gate is the whole verdict.
const NO_PROJECT = new Set(["mark", "explain"]);

export function gatesFor(mode, stage) {
  // An explain render is a delivered video like any other: it is probed and its loudness measured.
  if (mode === "explain" && stage === "dist") return [...MODE_GATES.explain, "probe", "loudness"];
  if (NO_PROJECT.has(mode)) return MODE_GATES[mode];
  return ["check", "offline", "palette", "seams", ...(stage === "dist" ? ["probe", "loudness"] : []), ...(MODE_GATES[mode] ?? [])];
}

async function loadGate(name) {
  for (const rel of MODULES[name] ?? []) {
    const path = join(here, rel);
    if (existsSync(path)) return import(pathToFileURL(path).href);
  }
  return null;
}

// Every gate skipping means nothing was measured: that is not a pass.
export function aggregate(results) {
  const statuses = results.map((r) => r.status);
  if (statuses.every((s) => s === "skip")) return "skip";
  return worst(statuses);
}

export async function runGates(ctx, names = gatesFor(ctx.mode ?? ctx.plan?.mode, ctx.stage), { write = true } = {}) {
  const results = [];
  for (const name of names) {
    const mod = await loadGate(name);
    if (!mod?.run) {
      results.push({ gate: name, status: "skip", reason: MODULES[name] ? `${name} module not available` : `unknown gate ${name}`, findings: [] });
      continue;
    }
    try {
      results.push(await mod.run(ctx));
    } catch (e) {
      results.push({ gate: name, status: "fail", findings: [finding(`${name}.crash`, "fail", { error: e.message.split("\n")[0] }, "The gate threw; fix the cause, a crashed gate never passes.")] });
    }
  }
  const report = { stage: ctx.stage, at: ctx.stage, results, status: aggregate(results) };
  if (write) writeJson(join(ctx.runDir, "gates.json"), report);
  return report;
}

export function table(report) {
  const rows = report.results.map((r) => {
    const rules = [...new Set(r.findings.filter((f) => f.status === "fail" || f.status === "warn").map((f) => (f.status === "warn" ? `(${f.rule})` : f.rule)))];
    return [r.gate, r.status, rules.join(", ") || (r.status === "skip" ? r.reason ?? "" : "")];
  });
  const w0 = Math.max(4, ...rows.map((r) => r[0].length)), w1 = 6;
  return [
    `${"gate".padEnd(w0)}  ${"status".padEnd(w1)}  rules`,
    ...rows.map(([g, s, x]) => `${g.padEnd(w0)}  ${s.padEnd(w1)}  ${x}`),
    `${report.stage}: ${report.status}`,
  ].join("\n");
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const ctx = await contextFromArgs(args);
  const only = list(args.only);
  const report = await runGates(ctx, only.length ? only : undefined);
  process.stdout.write((args.json ? JSON.stringify(report) : table(report)) + "\n");
  process.exit(report.status === "fail" || report.status === "skip" ? 1 : 0);
}
