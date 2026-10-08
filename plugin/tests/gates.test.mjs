import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSharp } from "../scripts/lib/browser.mjs";
import { writeJson } from "../scripts/lib/fs.mjs";
import { hint, insets, result, captionLines } from "../scripts/gates/common.mjs";
import { analyzeFrames, lintSequence, lintCopy, lintDuration, maxFlashes, run as adLint } from "../scripts/gates/ad-lint.mjs";
import { brandRoles, staticOffenders, dominantColors, offBrand } from "../scripts/gates/palette.mjs";
import { lintSteps } from "../scripts/gates/guide-lint.mjs";
import { compareProbe } from "../scripts/gates/probe.mjs";
import { judgeLoudness, loudnessTarget } from "../scripts/gates/loudness.mjs";
import { mapReport, captionZone } from "../scripts/gates/check.mjs";
import { mapSeams } from "../scripts/gates/seams.mjs";
import { aggregate, runGates, gatesFor } from "../scripts/gates/gate.mjs";

const sharp = loadSharp();
const tmp = mkdtempSync(join(tmpdir(), "compositor-gates-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const BRAND = {
  color: {
    roles: {
      light: { bg: { hex: "#f7f7f5" }, fg: { hex: "#16181d" }, accent: { hex: "#1f4fb8" } },
      dark: { bg: { hex: "#15171c" }, fg: { hex: "#eceef2" }, accent: { hex: "#5f92ea" } },
    },
    video: { nearBlack: "#1a1c21" },
  },
};
// Minimal stand-ins for scripts/targets/presets.mjs entries.
const TARGETS = {
  "reels-ad": { width: 64, height: 64, kind: "motion", fps: 10, safe: [0.14, 0.06, 0.35, 0.06], duration: { min: 6, max: 15 }, maxBytes: 1000 },
  "ig-square": { width: 1080, height: 1080, kind: "motion", safe: [0.04, 0.04, 0.04, 0.04] },
  "x-image": { width: 1200, height: 675, kind: "still", safe: [0.04, 0.04, 0.04, 0.04] },
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// 64×64 frame: flat background plus an optional square block.
async function frame(path, { bg, block, at = [8, 8], size = 24 }) {
  const buf = Buffer.alloc(64 * 64 * 3);
  const [br, bgc, bb] = hex(bg);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const inside = block && x >= at[0] && x < at[0] + size && y >= at[1] && y < at[1] + size;
      const [r, g, b] = inside ? hex(block) : [br, bgc, bb];
      buf.set([r, g, b], (y * 64 + x) * 3);
    }
  }
  await sharp(buf, { raw: { width: 64, height: 64, channels: 3 } }).png().toFile(path);
}

async function sequence(name, n, spec) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < n; i++) {
    const f = join(dir, `frame_${String(i).padStart(4, "0")}.png`);
    await frame(f, spec(i));
    files.push(f);
  }
  return { dir, files };
}

const statusOf = (findings, rule) => findings.find((f) => f.rule === rule)?.status;

test("ad-lint: a static run fails first change, holds the end card", async () => {
  const { files } = await sequence("static", 20, () => ({ bg: "#15171c", block: "#5f92ea" }));
  const f = lintSequence(await analyzeFrames(files), { fps: 10 });
  assert.equal(statusOf(f, "ad.first-change"), "fail");
  assert.equal(statusOf(f, "ad.empty-start"), "pass");
  assert.equal(statusOf(f, "ad.flash"), "pass");
  assert.equal(statusOf(f, "ad.end-card"), "pass");
});

test("ad-lint: a change at frame 3 passes first change at 0.3 s", async () => {
  const { files } = await sequence("change3", 20, (i) => ({ bg: "#15171c", block: "#5f92ea", at: i < 3 ? [8, 8] : [32, 32] }));
  const f = lintSequence(await analyzeFrames(files), { fps: 10 });
  const first = f.find((x) => x.rule === "ad.first-change");
  assert.equal(first.status, "pass");
  assert.equal(first.evidence.measured, 0.3);
  assert.equal(statusOf(f, "ad.end-card"), "pass");
});

test("ad-lint: a flashing run fails flash and end card; a flat frame 0 is empty", async () => {
  const { files } = await sequence("flash", 20, (i) => ({ bg: i % 2 ? "#ffffff" : "#000000" }));
  const frames = await analyzeFrames(files);
  const f = lintSequence(frames, { fps: 10 });
  assert.equal(statusOf(f, "ad.flash"), "fail");
  assert.ok(f.find((x) => x.rule === "ad.flash").evidence.measured > 3);
  assert.equal(statusOf(f, "ad.end-card"), "fail");
  assert.equal(statusOf(f, "ad.empty-start"), "fail");
  assert.ok(f.find((x) => x.rule === "ad.flash").hint.length > 0);
});

test("ad-lint: slow luminance changes are not flashes", () => {
  const lums = Array.from({ length: 60 }, (_, i) => (Math.floor(i / 10) % 2 ? 0.9 : 0.05));
  assert.ok(maxFlashes(lums, 30).max <= 3);
  assert.ok(maxFlashes(Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.9 : 0.05)), 30).max > 3);
});

test("ad-lint: copy and duration ladder", () => {
  const copy = lintCopy({ headline: "One two three four five six seven eight", cta: "" }, { cues: [{ text: "a".repeat(43) }, { text: "short one\nshort two\nshort three" }] });
  assert.equal(statusOf(copy, "ad.headline-words"), "fail");
  assert.equal(statusOf(copy, "ad.cta"), "fail");
  assert.equal(statusOf(copy, "ad.caption-line"), "fail");
  assert.equal(statusOf(copy, "ad.caption-lines"), "fail");
  assert.equal(statusOf(lintCopy({ headline: "Ship faster today", cta: "Try it" }), "ad.headline-words"), "pass");
  assert.equal(statusOf(lintCopy({ headline: "one two three four five six", cta: "Go" }, { bumper: true }), "ad.headline-words"), "warn");
  assert.equal(lintDuration(6.05, { bumper: true })[0].status, "pass");
  assert.equal(lintDuration(7, { bumper: true })[0].status, "fail");
  assert.equal(lintDuration(20, { vertical: true })[0].status, "warn");
  assert.equal(lintDuration(61, { vertical: true })[0].status, "fail");
  assert.equal(lintDuration(12, { vertical: true })[0].status, "pass");
});

test("ad-lint run(): frames override, skips outside ad mode", async () => {
  const { dir } = await sequence("run", 20, (i) => ({ bg: "#15171c", block: "#5f92ea", at: i < 3 ? [8, 8] : [32, 32] }));
  const plan = { mode: "ad", copy: { headline: "Ship faster today", cta: "Try it" }, compositions: [{ target: "reels-ad", kind: "motion", fps: 10, duration: 2 }] };
  const r = await adLint({ runDir: tmp, stage: "proof", plan, brand: BRAND, targets: TARGETS, frames: dir });
  assert.equal(r.gate, "ad-lint");
  assert.equal(r.status, "warn");
  assert.deepEqual(r.findings.map((f) => f.rule), ["ad.duration"]);
  assert.equal((await adLint({ runDir: tmp, stage: "proof", plan: { mode: "social" }, targets: TARGETS })).status, "skip");
});

test("palette: static check reports only the off-brand literal", () => {
  const roles = brandRoles(BRAND);
  assert.equal(roles.length, 7);
  const html = `<style>:root{--bg:#15171c;--ink:oklch(0.94 0.005 260)}
    .card{background:#1f4fb8;box-shadow:0 40px 90px -20px rgba(0,0,0,.4);color:#ff00aa;border-color:rgba(31,79,184,.3)}</style>`;
  const off = staticOffenders(html, roles);
  assert.deepEqual(off.map((o) => o.hex), ["#ff00aa"]);
  assert.ok(off[0].deltaE > 0.02);
  assert.deepEqual(staticOffenders("a{color:#000}", roles).map((o) => o.hex), ["#000000"]);
});

test("palette: sampled check flags a dominant off-brand colour, tolerates blends", async () => {
  const roles = brandRoles(BRAND);
  const bad = join(tmp, "off.png");
  await frame(bad, { bg: "#15171c", block: "#ff00aa", size: 32 });
  const flagged = offBrand(await dominantColors(bad), roles);
  assert.equal(flagged.length, 1);
  assert.ok(flagged[0].share > 0.2);

  const good = join(tmp, "good.png");
  await frame(good, { bg: "#15171c", block: "#5f92ea", size: 32 });
  const blurred = join(tmp, "good-blur.png");
  await sharp(good).blur(2).toFile(blurred);
  assert.deepEqual(offBrand(await dominantColors(blurred), roles), []);
});

test("guide-lint: pace, gap, zoom, captions, verb-first, caption-only hold", () => {
  const steps = [
    { index: 1, action: "click", start: 0, duration: 3, zoom: 1.5, narration: "Click Save.", caption: "Click Save" },
    { index: 2, action: "click", start: 3, duration: 0.8, zoom: 2.2, narration: "The dashboard opens with every chart you configured last week loaded.", caption: "Dashboard opens" },
    { index: 3, action: "type", start: 3.3, duration: 3, zoom: 3, narration: "Escribí tu email.", caption: "This caption is definitely much longer than forty-two characters and keeps going on and on and on to wrap past two lines" },
  ];
  const f = lintSteps(steps);
  const by = (rule, step) => f.find((x) => x.rule === rule && x.evidence.step === step)?.status;
  assert.equal(by("guide.pace", 1), "pass");
  assert.equal(by("guide.pace", 2), "fail");
  assert.equal(by("guide.gap", 2), "fail");
  assert.equal(by("guide.zoom", 2), "warn");
  assert.equal(by("guide.zoom", 3), "fail");
  assert.equal(by("guide.caption-lines", 3), "fail");
  assert.equal(by("guide.verb-first", 1), undefined);
  assert.equal(by("guide.verb-first", 2), "warn");
  assert.equal(by("guide.verb-first", 3), undefined);
  assert.equal(by("guide.narration-words", 2), undefined);
  assert.equal(lintSteps([{ start: 0, duration: 3, narration: "Click the big blue button at the top right corner of the main page." }])[1].rule, "guide.narration-words");
  const hold = lintSteps([{ start: 0, duration: 1.5, caption: "Open settings and pick the billing tab now" }], { captionOnly: true });
  assert.equal(statusOf(hold, "guide.caption-hold"), "fail");
  assert.deepEqual(captionLines("one\ntwo"), ["one", "two"]);
});

test("probe: comparison against a stubbed ffprobe result", () => {
  const info = {
    path: "dist/reels-ad/ad.mp4", duration: 4, size: 5000,
    video: { codec: "hevc", width: 63, height: 64, pixFmt: "yuv444p", fps: 30, colorPrimaries: "bt709", colorTransfer: undefined, colorSpace: "bt709" },
  };
  const f = compareProbe(info, TARGETS["reels-ad"], { file: info.path, comp: { kind: "motion", fps: 10 } });
  const rules = f.map((x) => x.rule).sort();
  assert.deepEqual(rules, ["probe.bt709", "probe.codec", "probe.dimensions", "probe.duration", "probe.even", "probe.fps", "probe.pix-fmt", "probe.size"]);
  assert.deepEqual(f.find((x) => x.rule === "probe.dimensions").evidence, { file: info.path, measured: "63x64", expected: "64x64" });

  const ok = { path: "a.mp4", duration: 8, size: 900, video: { codec: "h264", width: 64, height: 64, pixFmt: "yuv420p", fps: 10, colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709" } };
  assert.deepEqual(compareProbe(ok, TARGETS["reels-ad"], { file: "a.mp4", comp: { kind: "motion", fps: 10 } }), []);

  const still = { path: "x.mp4", size: 10, video: { codec: "h264", width: 1200, height: 675 } };
  assert.deepEqual(compareProbe(still, TARGETS["x-image"], { file: "x.mp4" }).map((x) => x.rule), ["probe.format"]);
  assert.deepEqual(compareProbe({ ...still, path: "x.png", video: { codec: "png", width: 1200, height: 675 } }, TARGETS["x-image"], { file: "x.png" }), []);
});

test("loudness: judgement and targets", () => {
  const want = loudnessTarget({ plan: {}, mode: "ad" }, {});
  assert.deepEqual(want, { lufs: -14, truePeak: -1, lra: 11 });
  assert.equal(loudnessTarget({ plan: { audio: { vo: "vo.wav" } }, mode: "guide" }, {}).lufs, -16);
  assert.deepEqual(judgeLoudness({ integrated: -14.4, truePeak: -1.2, range: 6 }, want, "a.mp4"), []);
  const bad = judgeLoudness({ integrated: -18, truePeak: -0.2, range: 14 }, want, "a.mp4");
  assert.deepEqual(bad.map((f) => [f.rule, f.status]), [["loudness.integrated", "fail"], ["loudness.true-peak", "fail"], ["loudness.lra", "warn"]]);
});

test("check: caption band from the motion targets, report mapping", () => {
  const plan = { compositions: [{ target: "reels-ad", kind: "motion" }, { target: "x-image", kind: "still" }] };
  assert.equal(captionZone({ plan, targets: TARGETS }), "x0=0;y0=0.65;x1=1;y1=1;severity=error");
  assert.equal(captionZone({ plan: { compositions: [{ target: "x-image", kind: "still" }] }, targets: TARGETS }), "x0=0;y0=1;x1=1;y1=1;severity=warning");
  assert.equal(captionZone({ plan: { compositions: [] }, targets: TARGETS }), null);
  const f = mapReport({
    ok: false,
    lint: { findings: [{ code: "font_family_without_font_face", severity: "error", message: "m", fixHint: "add @font-face" }] },
    layout: { findings: [{ code: "caption_zone_collision", severity: "warning", message: "m2" }, { code: "x", severity: "info" }] },
  });
  assert.deepEqual(f.map((x) => [x.rule, x.status]), [["hf:font_family_without_font_face", "fail"], ["hf:caption_zone_collision", "warn"]]);
  assert.equal(f[0].hint, "add @font-face");
  assert.match(f[1].hint, /caption band|safe band/);
  assert.equal(mapReport({ ok: false, error: "boom" })[0].status, "fail");
});

test("seams: rows map to findings", () => {
  const f = mapSeams([{ id: "s1", cut: 2, type: "match", rows: [{ check: "carrier", status: "PASS", detail: "" }, { check: "speed-match", status: "WARN", detail: "4x" }, { check: "exit-moving", status: "FAIL", detail: "static" }] }]);
  assert.deepEqual(f.map((x) => [x.rule, x.status]), [["seam.carrier", "pass"], ["seam.speed-match", "warn"], ["seam.exit-moving", "fail"]]);
  assert.equal(result("seams", f).status, "fail");
});

test("common: insets from every preset shape, hints from references/gates.md", () => {
  assert.deepEqual(insets({ safe: [0.1, 0.2, 0.3, 0.4] }), { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 });
  assert.deepEqual(insets({ safeBox: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.7 } }).bottom.toFixed(2), "0.30");
  assert.deepEqual(insets({ safe: { top: 0.1, bottom: 0.2 } }), { top: 0.1, right: 0, bottom: 0.2, left: 0 });
  assert.match(hint("probe.size"), /size-cap/);
  assert.match(hint("hf:unknown_code"), /hyperframes/);
});

test("gate: aggregation status and gates.json", async () => {
  assert.equal(aggregate([{ status: "pass" }, { status: "skip" }]), "pass");
  assert.equal(aggregate([{ status: "warn" }, { status: "pass" }]), "warn");
  assert.equal(aggregate([{ status: "warn" }, { status: "fail" }, { status: "skip" }]), "fail");
  assert.equal(aggregate([{ status: "skip" }, { status: "skip" }]), "skip");
  assert.deepEqual(gatesFor("ad", "dist"), ["check", "offline", "palette", "seams", "probe", "loudness", "ad-lint"]);
  assert.deepEqual(gatesFor("social", "proof"), ["check", "offline", "palette", "seams", "social-lint"]);

  const runDir = join(tmp, "run-guide");
  const plan = { mode: "guide", steps: [{ index: 1, start: 0, duration: 0.5, narration: "Click Save.", caption: "Save" }] };
  writeJson(join(runDir, "plan.json"), plan);
  const report = await runGates({ runDir, stage: "proof", plan, brand: BRAND, targets: TARGETS, mode: "guide" }, ["guide-lint", "ad-lint", "nope"]);
  assert.equal(report.status, "fail");
  assert.equal(report.at, "proof");
  assert.deepEqual(report.results.map((r) => [r.gate, r.status]), [["guide-lint", "fail"], ["ad-lint", "skip"], ["nope", "skip"]]);
  const written = JSON.parse(readFileSync(join(runDir, "gates.json"), "utf8"));
  assert.deepEqual(written, report);
  assert.ok(!JSON.stringify(written).match(/\d{4}-\d{2}-\d{2}T/));
});
