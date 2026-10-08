import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "../scripts/guide/narration.mjs";
import { buildParams, mergeSteps, changeRegions, inkExtent, overlayScript, closeZoomOnPageChange } from "../scripts/guide/plan.mjs";
import * as G from "../scripts/guide/overlay.mjs";

const line = (from, to) => Array.from({ length: 32 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / 31, from[1] + ((to[1] - from[1]) * i) / 31]);
const manifest = {
  title: "Rename a project",
  viewport: { width: 1440, height: 900 },
  scale: 2,
  locale: "en",
  steps: [
    { id: "open-menu", index: 0, action: "click", narration: "Click Projects.", caption: "Open the Projects menu", plate: "step-01.png", afterPlate: "step-01-after.png",
      bbox: { x: 1327.81, y: 14, w: 84.19, h: 40.5 }, center: [1369.91, 34.25], path: line([720, 450], [1369.91, 34.25]), zoom: 2, zoomGroup: 1 },
    { id: "type-name", index: 1, action: "type", narration: "Type the new name.", caption: "Type the new name", plate: "step-02.png", afterPlate: "step-02-after.png",
      bbox: { x: 389, y: 175, w: 662, h: 44.5 }, center: [720, 197.25], path: line([1369.91, 34.25], [720, 197.25]), zoom: 1.5, zoomGroup: 1, typed: { text: "Launch plan", chars: 11 } },
  ],
};
const timeline = { ...buildTimeline(manifest, [2.4, 1.9]), mix: "vo/mix.wav", captions: "captions.json" };
const cues = [{ start: 0.5, end: 2.9, lines: ["Click Projects."], words: [{ text: "Click", start: 0.5, end: 0.9 }] }];

test("plan merge: manifest geometry + timeline times on the video clock, plates under assets/captures", () => {
  const p = buildParams({ manifest, timeline, cues, title: "Rename it" });
  assert.equal(p.title, "Rename it");
  assert.deepEqual(p.viewport, manifest.viewport);
  assert.equal(p.scale, 2);
  assert.equal(p.intro, 1.5);
  assert.equal(p.duration, Math.round((1.5 + timeline.duration + 1.5) * 1000) / 1000);
  assert.equal(p.endAt, Math.round((1.5 + timeline.duration) * 1000) / 1000);
  const [a, b] = p.steps;
  assert.equal(a.start, timeline.steps[0].start + 1.5);
  assert.equal(a.clickAt, Math.round((timeline.steps[0].clickAt + 1.5) * 1000) / 1000);
  assert.equal(a.zoomIn, Math.round((timeline.steps[0].zoomIn + 1.5) * 1000) / 1000);
  assert.equal(a.plate, "assets/captures/step-01.png");
  assert.equal(a.afterPlate, "assets/captures/step-01-after.png");
  assert.equal(a.path.length, 32);
  assert.deepEqual(a.bbox, manifest.steps[0].bbox);
  assert.equal(a.zoomGroup, timeline.steps[0].zoomGroup);
  assert.deepEqual(b.typed, { text: "Launch plan", chars: 11 });
  assert.equal(p.captions[0].start, 2);
  assert.equal(p.captions[0].words[0].end, 2.4);
  assert.equal(p.captionOnly, false);
  assert.equal(buildParams({ manifest, timeline, captionOnly: true }).captionOnly, true);
});

test("plan merge rejects a timeline from another manifest", () => {
  assert.throws(() => mergeSteps(manifest, { ...timeline, steps: timeline.steps.slice(0, 1) }), /2 steps, timeline 1/);
  const swapped = { ...timeline, steps: [...timeline.steps].reverse() };
  assert.throws(() => mergeSteps(manifest, swapped), /manifest id "open-menu"/);
});

test("pan dead zone: 15% inset on each side of the window", () => {
  const win = { cx: 500, cy: 300, w: 400, h: 200 };
  assert.equal(G.inDeadZone([500, 300], win), true);
  assert.equal(G.inDeadZone([360, 300], win), true);
  assert.equal(G.inDeadZone([359, 300], win), false);
  assert.equal(G.inDeadZone([500, 230], win), true);
  assert.equal(G.inDeadZone([500, 229], win), false);
  assert.equal(G.inDeadZone([359, 300], win, 0), true);
});

test("typing reveal: chars × 0.05 s from clickAt over the typed span or the bbox", () => {
  assert.equal(G.typingSpan(11), 0.55);
  assert.equal(G.typingSpan(0), 0.05);
  const s = { clickAt: 10, bbox: { x: 389, y: 175, w: 662, h: 44.5 }, typed: { chars: 11 } };
  assert.deepEqual(G.typingReveal(s), { start: 10, end: 10.55, span: 0.55, chars: 11, x0: 389, x1: 1051, y0: 175, y1: 219.5 });
  assert.equal(G.typingReveal({ ...s, typed: { chars: 11, reveal: [401, 485] } }).x1, 485);
});

test("camera: zooms once per group around the target, stays inside the viewport, never past 2.5×", () => {
  const p = buildParams({ manifest, timeline });
  const view = { w: 1440, h: 900 }, bounds = { w: 1440, h: 900 };
  const plan = G.cameraPlan(p.steps, { view, bounds });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].zoom, 2);
  const [a, b] = p.steps;
  assert.deepEqual(G.cameraAt(plan, a.zoomIn - 0.01), { cx: 720, cy: 450, z: 1 });
  const held = G.cameraAt(plan, a.zoomIn + 1);
  assert.equal(held.z, 2);
  assert.ok(G.containsBox(G.windowOf(held, view), a.bbox));
  // The field leaves the dead zone of the menu framing: one pan, starting 0.3 s before the click.
  const pan = plan.groups[0].focus.find((m) => m.step === 1);
  assert.equal(Math.round((pan.t0 - (b.clickAt - 0.3)) * 1000), 0);
  assert.ok(G.containsBox(G.windowOf(G.cameraAt(plan, b.clickAt + 0.5), view), b.bbox));
  assert.equal(G.cameraAt(plan, b.end + 0.01).z, 1);
  for (const c of G.sampleFrames(p.duration, 30, (t) => G.cameraAt(plan, t))) {
    const w = G.windowOf(c, view);
    assert.ok(c.z >= 1 && c.z <= 2.5);
    assert.ok(w.cx - w.w / 2 >= -1e-6 && w.cx + w.w / 2 <= 1440 + 1e-6 && w.cy - w.h / 2 >= -1e-6 && w.cy + w.h / 2 <= 900 + 1e-6);
  }
  // A narrow crop caps the group zoom so the field still fits.
  const narrow = G.cameraPlan(p.steps, { view: { w: 1000, h: 900 }, bounds });
  assert.ok(narrow.groups[0].zoom <= 1000 / (662 + 32) + 1e-9);
});

test("cursor: enters from below the frame, lands on each target at clickAt, leaves through the bottom", () => {
  const p = buildParams({ manifest, timeline });
  const plan = G.cameraPlan(p.steps, { view: { w: 1440, h: 900 }, bounds: { w: 1440, h: 900 } });
  const segs = G.cursorPlan(p.steps, plan, { offscreen: 80 });
  assert.ok(G.cursorAt(segs, 0)[1] > 900);
  assert.deepEqual(G.cursorAt(segs, p.steps[0].start), [720, 450]);
  for (const s of p.steps) assert.deepEqual(G.cursorAt(segs, s.clickAt).map(Math.round), s.center.map(Math.round));
  assert.ok(G.cursorAt(segs, p.duration)[1] > 900);
});

test("change regions and ink extent", () => {
  const cols = 10, rows = 4;
  const cells = Array(cols * rows).fill(false);
  for (const i of [0, 1, 11, 8, 9]) cells[i] = true;
  assert.deepEqual(changeRegions(cells, cols, rows, 1), [{ c0: 0, r0: 0, c1: 1, r1: 1 }, { c0: 8, r0: 0, c1: 9, r1: 0 }]);
  assert.equal(changeRegions(cells, cols, rows, 7).length, 1);
  const w = 6, h = 2, data = new Uint8Array(w * h * 3).fill(255);
  data.set([0, 0, 0], (1 * w + 2) * 3);
  data.set([0, 0, 0], (1 * w + 4) * 3);
  assert.deepEqual(inkExtent(data, w, 3, { x0: 0, y0: 0, x1: w, y1: h }, [255, 255, 255]), { x0: 2, x1: 5, y0: 1, y1: 2 });
  assert.equal(inkExtent(new Uint8Array(w * h * 3).fill(255), w, 3, { x0: 0, y0: 0, x1: w, y1: h }, [255, 255, 255]), null);
});

test("overlay script: every export reaches window.GuideOverlay and runs", () => {
  const src = overlayScript();
  const window = {};
  new Function("window", src)(window);
  assert.deepEqual(Object.keys(window.GuideOverlay).sort(), Object.keys(G).sort());
  assert.equal(window.GuideOverlay.typingSpan(11), 0.55);
  assert.equal(window.GuideOverlay.ease("power3.out", 0.5), G.ease("power3.out", 0.5));
});

test("a click that swaps the page closes its zoom after the ripple and splits its group", () => {
  const steps = [
    { clickAt: 2, zoomIn: 1.7, zoomOut: 5, zoomGroup: 1, pageChange: false },
    { clickAt: 6, zoomIn: 5.7, zoomOut: 9, zoomGroup: 1, pageChange: true },
    { clickAt: 10, zoomIn: 9.7, zoomOut: 12, zoomGroup: 1, pageChange: false },
    { clickAt: 13, zoomIn: null, zoomOut: null, zoomGroup: null, pageChange: true },
  ];
  closeZoomOnPageChange(steps, 0.4);
  assert.equal(steps[1].zoomOut, 6.4);
  assert.deepEqual(steps.map((s) => s.zoomGroup), [1, 1, 2, null]);
  assert.equal(steps[3].zoomOut, null);
  // Opening its group, the page swap does not zoom; its group's followers move on.
  const alone = [
    { clickAt: 2, zoomIn: 1.7, zoomOut: 5, zoomGroup: 4, zoom: 2, pageChange: true },
    { clickAt: 6, zoomIn: 5.7, zoomOut: 9, zoomGroup: 4, zoom: 1.5, pageChange: false },
  ];
  closeZoomOnPageChange(alone, 0.4);
  assert.deepEqual([alone[0].zoom, alone[0].zoomIn, alone[0].zoomGroup], [1, null, null]);
  assert.equal(alone[1].zoomGroup, 5);
});
