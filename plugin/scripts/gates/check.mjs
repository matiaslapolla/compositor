// hyperframes check --strict --frame-check [--caption-zone] mapped to findings.
// One check per project directory: the caption band is the most conservative
// bottom safe inset among the motion compositions.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { check } from "../lib/hyperframes.mjs";
import { finding, result, skip, insets, isStill, compositions, cli, isMain } from "./common.mjs";

const GATE = "check";
const SECTIONS = ["lint", "runtime", "layout", "motion", "contrast"];

// Caption band per composition: the target's bottom inset for motion; a still
// carries no captions, so its band is empty (HyperFrames would otherwise apply
// its default ~10% band).
export function captionZone(ctx, targetName) {
  const comps = compositions(ctx.plan).filter((c) => !targetName || c.target === targetName);
  let y0 = null;
  let anyStill = false;
  for (const comp of comps) {
    const target = ctx.targets?.[comp.target];
    if (!target) continue;
    if (isStill(comp, target)) { anyStill = true; continue; }
    const bottom = insets(target).bottom;
    if (bottom > 0) y0 = Math.min(y0 ?? 1, 1 - bottom);
  }
  if (y0 === null) return anyStill ? "x0=0;y0=1;x1=1;y1=1;severity=warning" : null;
  return `x0=0;y0=${Number(y0.toFixed(4))};x1=1;y1=1;severity=error`;
}

export function mapReport(data) {
  if (data.error) return [finding("hf:check_error", "fail", { message: data.error })];
  const findings = [];
  for (const name of SECTIONS) {
    for (const f of data[name]?.findings ?? []) {
      if (f.severity !== "error" && f.severity !== "warning") continue;
      findings.push(
        finding(`hf:${f.code}`, f.severity === "error" ? "fail" : "warn", {
          section: name, message: f.message, selector: f.selector, file: f.sourceFile, time: f.time,
        }, f.fixHint),
      );
    }
  }
  return findings;
}

// One hyperframes project per target: project/<target>/index.html (build.mjs).
function projectDirs(runDir) {
  const project = join(runDir, "project");
  if (!existsSync(project)) return [];
  if (existsSync(join(project, "index.html"))) return [project];
  return readdirSync(project).filter((d) => !d.startsWith("_") && existsSync(join(project, d, "index.html"))).map((d) => join(project, d));
}

export async function run(ctx) {
  const dirs = projectDirs(ctx.runDir);
  if (!dirs.length) return result(GATE, [finding("hf:no_project", "fail", { reason: "no HyperFrames project (project/<target>/index.html)" }, "Run build.mjs first.")]);
  const findings = [];
  const zones = {};
  for (const dir of dirs) {
    const name = dir.split("/").at(-1);
    const zone = captionZone(ctx, dirs.length > 1 || ctx.plan?.compositions?.length ? name : undefined);
    zones[name] = zone;
    let r;
    try {
      r = check(dir, { captionZone: zone ?? undefined });
    } catch (e) {
      return result(GATE, [finding("hf:unavailable", "fail", { reason: e.message.split("\n")[0] }, "Install hyperframes globally (npm i -g hyperframes) and run doctor.mjs.")]);
    }
    if (!r.data || typeof r.data !== "object") return skip(GATE, `hyperframes check produced no JSON (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split("\n").at(-1) ?? ""}`);
    for (const f of mapReport(r.data)) findings.push({ ...f, evidence: { target: name, ...(typeof f.evidence === "object" && f.evidence ? f.evidence : { detail: f.evidence }) } });
  }
  return result(GATE, findings, { captionZones: zones, projects: dirs.length });
}

if (isMain(import.meta.url)) await cli(run);
