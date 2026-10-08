// Promo mode, the mute-mode rule: the captions carry every narrated word.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../lib/fs.mjs";
import { finding, result, skip, cli, isMain, readCaptionCues } from "./common.mjs";

const GATE = "promo-lint";
export const MIN_COVERAGE = 0.95;

export const normalize = (text) => String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}%\s]/gu, " ").split(/\s+/).filter(Boolean);

// Share of narration tokens present in the captions (multiset).
export function coverage(narration, captions) {
  const want = normalize(narration);
  if (!want.length) return 1;
  const have = new Map();
  for (const w of normalize(captions)) have.set(w, (have.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) { const n = have.get(w) ?? 0; if (n > 0) { hit++; have.set(w, n - 1); } }
  return hit / want.length;
}

export async function run(ctx) {
  const plan = ctx.plan ?? {};
  const scriptPath = join(ctx.runDir, plan.script ?? "script.json");
  const script = existsSync(scriptPath) ? readJson(scriptPath, null) : null;
  const lists = [plan.scenes, plan.params?.scenes, script?.scenes].filter(Array.isArray);
  const scenes = lists.find((l) => l.some((s) => s.narration)) ?? [];
  const narration = scenes.map((s) => s.narration).filter(Boolean).join(" ");
  if (!narration) return skip(GATE, "no narration in plan.scenes (caption-only promo)");
  const path = plan.audio?.captions ? join(ctx.runDir, plan.audio.captions) : null;
  if (!path || !existsSync(path)) return result(GATE, [finding("promo.captions-mirror-vo", "fail", { reason: "plan.audio.captions missing: narrated claims need on-screen text" })]);
  const cues = readCaptionCues(path);
  const text = cues.map((c) => c.text ?? (c.lines ?? []).join(" ")).join(" ");
  const c = coverage(narration, text);
  return result(GATE, [finding("promo.captions-mirror-vo", c >= MIN_COVERAGE ? "pass" : "fail", { measured: Number(c.toFixed(3)), expected: `≥ ${MIN_COVERAGE} of narration words in captions`, cues: cues.length })]);
}

if (isMain(import.meta.url)) await cli(run);
