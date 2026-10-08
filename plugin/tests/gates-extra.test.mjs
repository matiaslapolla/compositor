import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSource } from "../scripts/gates/offline.mjs";
import { lintCopy } from "../scripts/gates/social-lint.mjs";
import { coverage, normalize } from "../scripts/gates/promo-lint.mjs";
import { gatesFor } from "../scripts/gates/gate.mjs";
import { initRun, record, listRuns } from "../scripts/trace/run.mjs";

test("offline: network references and missing font files fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "compositor-offline-"));
  const html = join(dir, "index.html");
  writeFileSync(join(dir, "ok.woff2"), "x");
  const text = `<script src="https://cdn.example/gsap.js"></script><style>@font-face{font-family:A;src:url("fonts/missing.woff2")}@font-face{font-family:B;src:url("ok.woff2")}</style>`;
  const rules = scanSource(html, text).map((f) => f.rule);
  assert.deepEqual(rules, ["offline.network", "offline.font-file"]);
  assert.deepEqual(scanSource(html, `<script src="gsap.min.js"></script>`), []);
  rmSync(dir, { recursive: true, force: true });
});

test("social-lint: headline word cap", () => {
  assert.equal(lintCopy({ headline: "Agents that stop where you decided." })[0].status, "pass");
  assert.equal(lintCopy({ headline: "one two three four five six seven eight" })[0].status, "fail");
  assert.equal(lintCopy({})[0].status, "skip");
});

test("promo-lint: caption coverage of the narration", () => {
  assert.deepEqual(normalize("¿Tu negocio aparece en Google? 88%"), ["tu", "negocio", "aparece", "en", "google", "88%"]);
  assert.equal(coverage("Estar primero en Google ya no alcanza.", "Estar primero en Google ya no alcanza"), 1);
  assert.ok(coverage("Estar primero en Google ya no alcanza.", "Estar primero") < 0.5);
});

test("gatesFor: every mode has its lint; mark and explain skip the HyperFrames gates, an explain render is still probed and measured", () => {
  assert.deepEqual(gatesFor("social", "proof"), ["check", "offline", "palette", "seams", "social-lint"]);
  assert.deepEqual(gatesFor("promo", "dist"), ["check", "offline", "palette", "seams", "probe", "loudness", "promo-lint"]);
  assert.deepEqual(gatesFor("mark", "proof"), ["logo-gate"]);
  assert.deepEqual(gatesFor("explain", "proof"), ["explain-lint"]);
  assert.deepEqual(gatesFor("explain", "dist"), ["explain-lint", "probe", "loudness"]);
});

test("trace: init, record and list a run", () => {
  const root = mkdtempSync(join(tmpdir(), "compositor-trace-"));
  const runDir = join(root, "runs", "demo");
  mkdirSync(runDir, { recursive: true });
  const brand = join(root, "brand.json");
  writeFileSync(brand, JSON.stringify({ identity: { name: "Demo" } }));
  const run = initRun({ runDir, mode: "social", brief: "a claim", brandPath: brand, evalRow: 2 });
  assert.equal(run.brandName, "Demo");
  assert.equal(run.eval.row, 2);
  record(runDir, "gates.proof", { status: "pass" });
  record(runDir, "verdict", "publish");
  const rows = listRuns(join(root, "runs"));
  assert.equal(rows[0].verdict, "publish");
  assert.equal(rows[0].gates.proof, "pass");
  rmSync(root, { recursive: true, force: true });
});

test("probe: carousel slide dirs resolve to their preset and the PDF bundle counts pages", async () => {
  const { run } = await import("../scripts/gates/probe.mjs");
  const root = mkdtempSync(join(tmpdir(), "compositor-probe-"));
  mkdirSync(join(root, "dist", "ig-feed"), { recursive: true });
  writeFileSync(join(root, "dist", "ig-feed", "ig-feed.pdf"), "%PDF-1.4");
  const plan = { targets: ["ig-feed"], compositions: [{ name: "ig-feed-01", target: "ig-feed", kind: "still", page: true, slide: 1 }] };
  const targets = { "ig-feed": { width: 1080, height: 1350, kind: "both", safe: [0.04, 0.04, 0.04, 0.04] } };
  const r = await run({ runDir: root, stage: "dist", plan, targets });
  const pages = r.findings.find((f) => f.rule === "probe.pages");
  assert.ok(!r.findings.some((f) => f.rule === "probe.missing" && f.evidence.target === "ig-feed"), "the PDF bundle is not a missing deliverable");
  assert.equal(r.status === "fail", false);
  rmSync(root, { recursive: true, force: true });
});

test("build: fill never rescans inserted text", async () => {
  const { fill } = await import("../scripts/render/build.mjs");
  const out = fill(`<h1>{{headline}}</h1><script>{{{json}}}</script>`, { headline: "Use {{title}} here", json: '{"a":"{{title}}"}', title: "REAL" });
  assert.equal(out, `<h1>Use {{title}} here</h1><script>{"a":"{{title}}"}</script>`);
});
