import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cursorPath, decideZoom, validateSteps } from "../scripts/guide/capture-steps.mjs";
import { buildTimeline, captionOnlySeconds, measureWpm, planSteps } from "../scripts/guide/narration.mjs";
import { cuesFromWords, cuesFromText, wordsFromText, toSrt, toVtt, captionLint } from "../scripts/guide/captions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "../scripts/guide/capture-steps.mjs");
const fx = (name) => join(here, "fixtures", name);

test("cursor path: 32 samples, exact endpoints, deterministic, bends to alternating sides", () => {
  const a = cursorPath([100, 100], [500, 400], 0);
  assert.equal(a.length, 32);
  assert.deepEqual(a[0], [100, 100]);
  assert.deepEqual(a.at(-1), [500, 400]);
  assert.deepEqual(cursorPath([100, 100], [500, 400], 0), a);
  const b = cursorPath([100, 100], [500, 400], 1);
  // Signed distance of the midpoint from the chord: opposite signs, |offset| = 0.75 · 12% · 500 px.
  const side = (p) => ((p[0] - 100) * 300 - (p[1] - 100) * 400) / 500;
  const mid = (path) => path[Math.floor(path.length / 2)];
  assert.ok(side(mid(a)) * side(mid(b)) < 0);
  const offset = cursorPath([0, 0], [1000, 0], 0, 3)[1];
  assert.deepEqual(offset, [500, 90]);
  assert.ok(cursorPath([10, 10], [10, 10], 3).every((p) => p[0] === 10 && p[1] === 10));
});

test("zoom rule: 1.5 default, 2 under 120 px, auto applies the rule, explicit capped at 2.5", () => {
  assert.equal(decideZoom("click", { x: 0, y: 0, w: 200, h: 40 }), 1.5);
  assert.equal(decideZoom("click", { x: 0, y: 0, w: 90, h: 32 }), 2);
  assert.equal(decideZoom("click", { x: 0, y: 0, w: 120, h: 32 }), 1.5);
  assert.equal(decideZoom("type", { x: 0, y: 0, w: 600, h: 40 }, "auto"), 1.5);
  assert.equal(decideZoom("wait", { x: 0, y: 0, w: 80, h: 40 }), 1);
  assert.equal(decideZoom("wait", { x: 0, y: 0, w: 80, h: 40 }, "auto"), 2);
  assert.equal(decideZoom("navigate", null), 1);
  assert.equal(decideZoom("click", { x: 0, y: 0, w: 10, h: 10 }, 4), 2.5);
  assert.equal(decideZoom("click", { x: 0, y: 0, w: 10, h: 10 }, 1), 1);
});

test("validateSteps names the step for each schema error", () => {
  const { errors } = validateSteps({ steps: [{ id: "a", action: "click", narration: "Click Save.", caption: "Save" }] });
  assert.deepEqual(errors, ['step 1 "a" (click): missing selector']);
  assert.deepEqual(validateSteps({ steps: [] }).errors, ["steps must be a non-empty array"]);
  const ok = validateSteps({ steps: [{ id: "a", action: "type", selector: "#n", text: "x", narration: "Type x.", caption: "x" }] });
  assert.deepEqual(ok.errors, []);
  const wait = (waitFor) => validateSteps({ steps: [{ id: "a", action: "click", selector: "#n", waitFor, narration: "Click n.", caption: "n" }] }).errors;
  assert.deepEqual(wait("table a"), []);
  assert.deepEqual(wait(""), ['step 1 "a" (click): waitFor must be a selector string']);
});

test("--dry rejects a bad steps file with exit 2 and named errors, no browser", () => {
  const r = spawnSync(process.execPath, [capture, "--steps", fx("guide-bad-steps.json"), "--dry", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('step 1 "open-menu" (click): missing selector'));
  assert.ok(out.errors.includes('step 2 "go" (navigate): missing url'));
  assert.ok(out.errors.some((e) => e.startsWith('step 3 "go" (teleport): duplicate id')));
  assert.ok(out.errors.some((e) => e.includes("action must be one of")));
  assert.ok(out.errors.some((e) => e.includes("missing narration")));
  assert.ok(out.errors.some((e) => e.includes("zoom must be")));
  const good = spawnSync(process.execPath, [capture, "--steps", fx("guide-app/steps.json"), "--dry", "--json"], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
});

const fakeManifest = {
  viewport: { width: 1440, height: 900 },
  scale: 2,
  locale: "en",
  steps: [
    { id: "open", action: "click", narration: "Click Projects to open the menu.", caption: "Open", path: [[720, 450], [1300, 30]], zoom: 2, changesUi: true },
    { id: "rename", action: "click", narration: "Choose Rename.", caption: "Rename", path: [[1300, 30], [1300, 90]], zoom: 2, changesUi: true },
    { id: "wait", action: "wait", narration: "Wait for the save.", caption: "Saved", path: [[1300, 90], [1300, 90]], zoom: 1, changesUi: false },
    { id: "done", action: "click", narration: "Click Done.", caption: "Done", path: [[1300, 90], [700, 500]], zoom: 1.5, holdMs: 3000 },
  ],
};

test("timeline math: pauses, minimum step, travel by distance, click, zoom lead, hold, groups", () => {
  const t = buildTimeline(fakeManifest, [2.4, 0.9, 1.0, 1.1], { vo: ["vo/step-01.wav", "vo/step-02.wav", "vo/step-03.wav", "vo/step-04.wav"] });
  const [a, b, c, d] = t.steps;
  const diag = Math.hypot(1440, 900);
  assert.equal(t.fps, 30);

  assert.equal(a.start, 0.5);
  assert.equal(a.travel, Math.round((0.35 + 0.25 * Math.hypot(580, 420) / diag) * 1000) / 1000);
  assert.equal(a.clickAt, Math.round((0.5 + a.travel) * 1000) / 1000);
  assert.equal(a.zoomIn, Math.round((a.clickAt - 0.3) * 1000) / 1000);
  assert.equal(a.end, 3.5); // 0.5 + 2.4 + 0.6 beats click + 1.2 hold + 0.7 out
  assert.equal(a.zoomOut, 2.8);
  assert.equal(a.voStart, a.start);
  assert.equal(a.vo, "vo/step-01.wav");

  assert.equal(b.start, 4.3); // previous step changed the UI: 0.8 s pause
  assert.equal(b.end, Math.round((b.clickAt + 1.2 + 0.7) * 1000) / 1000); // short VO: hold + zoom-out dominate the 2 s minimum
  assert.equal(b.zoomGroup, a.zoomGroup); // zoom segments < 1.5 s apart merge

  assert.equal(c.start, Math.round((b.end + 0.8) * 1000) / 1000);
  assert.equal(c.travel, 0);
  assert.equal(c.end, Math.round((c.start + 2) * 1000) / 1000); // 2 s minimum
  assert.equal(c.zoomIn, null);
  assert.equal(c.zoomGroup, null);

  assert.equal(d.start, Math.round((c.end + 0.5) * 1000) / 1000); // no UI change: 0.5 s
  assert.equal(d.end, Math.round((d.clickAt + 3 + 0.7) * 1000) / 1000); // holdMs 3000
  assert.ok(d.zoomGroup > a.zoomGroup);
  assert.equal(t.duration, Math.round((d.end + 0.5) * 1000) / 1000);
  for (const s of t.steps) assert.ok(s.travel === 0 || (s.travel >= 0.35 && s.travel <= 0.6));
});

test("caption-only durations and WPM measurement", () => {
  assert.equal(captionOnlySeconds("Save"), 1.2);
  assert.equal(captionOnlySeconds("x".repeat(45)), 3);
  const wpm = measureWpm(fakeManifest, [2.4, 0.9, 1.0, 1.1]);
  assert.equal(wpm.steps[0].wpm, 150); // 6 words in 2.4 s
  assert.ok(wpm.outliers.includes("wait"));
});

const thirty =
  "Open the Projects menu in the top right corner, then choose Rename from the list, type the new name for your project, and press Enter to save it for everyone.";

test("captions: a 30-word sentence at 150 wpm becomes several legal cues", () => {
  assert.equal(thirty.split(" ").length, 30);
  const cues = cuesFromText(thirty, 0, 12);
  assert.ok(cues.length >= 2);
  for (const c of cues) {
    assert.ok(c.lines.length <= 2);
    for (const line of c.lines) assert.ok(line.length <= 42, line);
    assert.ok(c.lines.join(" ").length / (c.end - c.start) <= 20);
    assert.ok(c.end - c.start >= 0.83);
  }
  assert.equal(cues.flatMap((c) => c.words.map((w) => w.text)).join(" "), thirty);
  assert.deepEqual(captionLint(cues), []);
  // Clause boundaries are preferred: no cue ends on a conjunction.
  for (const c of cues.slice(0, -1)) assert.ok(!/^(and|then|so|or)$/i.test(c.words.at(-1).text));
});

test("captions: transcribe-shaped words with segment-level entries and multiple sentences", () => {
  const words = [
    { id: 0, text: "Click", start: 0, end: 0.3 },
    { id: 1, text: "Save.", start: 0.3, end: 0.7 },
    { id: 2, text: "Your changes are stored", start: 2.0, end: 3.2 },
  ];
  const cues = cuesFromWords(words);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0].lines, ["Click Save."]);
  assert.equal(cues[0].end, 0.83);
  assert.equal(cues[1].words.length, 4);
  assert.equal(wordsFromText("a bb", 0, 1).at(-1).end, 1);
});

test("toSrt and toVtt formatting", () => {
  const cues = [
    { start: 0.5, end: 2.25, lines: ["Open the Projects menu"], words: [] },
    { start: 3661.007, end: 3663, lines: ["Choose Rename,", "then type the name"], words: [] },
  ];
  assert.equal(toSrt(cues), "1\n00:00:00,500 --> 00:00:02,250\nOpen the Projects menu\n\n2\n01:01:01,007 --> 01:01:03,000\nChoose Rename,\nthen type the name\n");
  assert.ok(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.500 --> 00:00:02.250\nOpen the Projects menu\n"));
});

test("captionLint catches a 50-char line, three lines, fast reading and short holds", () => {
  const long = "x".repeat(50);
  const findings = captionLint([
    { start: 0, end: 4, lines: [long], words: [] },
    { start: 4, end: 4.5, lines: ["a", "b", "c"], words: [] },
    { start: 5, end: 6, lines: ["This line is quite a lot to read in 1 s"], words: [] },
  ]);
  const rules = findings.map((f) => `${f.cue}:${f.rule}`);
  assert.ok(rules.includes("0:caption.chars-per-line"));
  assert.ok(rules.includes("1:caption.lines"));
  assert.ok(rules.includes("1:caption.min-hold"));
  assert.ok(rules.includes("2:caption.cps"));
  assert.ok(findings.every((f) => f.status === "fail" && f.evidence && f.hint));
});

test("captions: a pause ends a cue even without punctuation (caption-only steps)", () => {
  const words = [...wordsFromText("Open the Projects menu", 0.5, 1.97), ...wordsFromText("Choose Rename", 3.37, 4.6)];
  const cues = cuesFromWords(words);
  assert.deepEqual(cues.map((c) => c.lines.join(" ")), ["Open the Projects menu", "Choose Rename"]);
});

test("planSteps feeds guide-lint with duration and actionAt", async () => {
  const { lintSteps } = await import("../scripts/gates/guide-lint.mjs");
  const t = buildTimeline(fakeManifest, [2.4, 0.9, 1.0, 1.1]);
  const steps = planSteps(fakeManifest, t);
  assert.deepEqual(Object.keys(steps[0]), ["index", "id", "start", "duration", "actionAt", "zoom", "zoomGroup", "narration", "caption", "captionDuration"]);
  assert.equal(steps[1].duration, Math.round((t.steps[1].end - t.steps[1].start) * 1000) / 1000);
  assert.deepEqual(lintSteps(steps).filter((f) => f.status === "fail"), []);
});
