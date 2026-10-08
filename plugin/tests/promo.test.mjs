import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPromoTimeline, captionOnlySeconds, promoCues, partitionWords, voiceover, PROMO_TIMING, PROMO_CAPTIONS } from "../scripts/promo/voiceover.mjs";
import { planPromo, promoLedger, checkScript, mergePlan } from "../scripts/promo/plan.mjs";
import { captionLint, CAPTION_DEFAULTS } from "../scripts/guide/captions.mjs";
import { loadTemplate } from "../scripts/render/build.mjs";
import { ledgers } from "../scripts/gates/seams.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "fixtures/promo/script.json");
const script = JSON.parse(readFileSync(SCRIPT, "utf8"));
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const tmp = () => mkdtempSync(join(tmpdir(), "promo-test-"));

test("buildPromoTimeline: lead, gaps, holds, tail and contiguous scenes on frames", () => {
  const t = buildPromoTimeline(script, [3, 2.5, 3.2, 2]);
  assert.equal(t.fps, 30);
  const [a, b, c, d] = t.scenes;
  close(a.start, 0);
  close(a.voStart, PROMO_TIMING.lead);
  close(b.voStart, 0.3 + 3 + 0.4);
  close(c.voStart, b.voStart + 2.5 + 0.5 + 0.4, 1e-3);
  close(d.voStart, c.voStart + 3.2 + 0.4);
  close(t.duration, Math.round((d.voStart + 2 + PROMO_TIMING.tail) * 30) / 30);
  t.scenes.forEach((s, i) => {
    if (i) {
      close(s.start, Math.round((s.voStart - PROMO_TIMING.cutLead) * 30) / 30);
      close(t.scenes[i - 1].end, s.start);
      assert.ok(s.voStart - (t.scenes[i - 1].voStart + t.scenes[i - 1].voDuration) >= 0.4 - 1e-9, "≥ 0.4 s between voices");
      assert.ok(s.start >= t.scenes[i - 1].voStart + t.scenes[i - 1].voDuration, "a cut never interrupts the previous voice");
    }
    close(s.start * 30, Math.round(s.start * 30));
  });
  close(d.end, t.duration);
  assert.equal(t.scenes[1].caption, "Estar primero en Google ya no alcanza.");
});

test("buildPromoTimeline: empty script throws", () => {
  assert.throws(() => buildPromoTimeline({ scenes: [] }, []));
});

test("captionOnlySeconds: max(2.5 s, chars / 15)", () => {
  assert.equal(captionOnlySeconds("Corto."), 2.5);
  const long = "x".repeat(60);
  close(captionOnlySeconds(long), 4);
});

test("voiceover --caption-only: no TTS, scenes timed by caption length, cues inside each scene", async () => {
  const out = tmp();
  const r = await voiceover({ scriptPath: SCRIPT, outDir: out, captionOnly: true });
  assert.equal(r.mix, null);
  assert.equal(r.wpm, null);
  const want = script.scenes.map((s) => captionOnlySeconds(s.caption || s.narration));
  r.timeline.scenes.forEach((s, i) => close(s.voDuration, Math.round(want[i] * 1000) / 1000));
  assert.ok(existsSync(join(out, "timeline.json")) && existsSync(join(out, "captions.srt")) && existsSync(join(out, "captions.vtt")));
  assert.match(readFileSync(join(out, "captions.srt"), "utf8"), /example\.com/);
  for (const c of r.cues) {
    const s = r.timeline.scenes.find((x) => c.start >= x.start - 1e-9 && c.start < x.end);
    assert.ok(s && c.end <= s.end + 1e-9, "a cue never straddles a cut");
  }
  assert.deepEqual(captionLint(r.cues, PROMO_CAPTIONS), []);
});

test("partitionWords: balanced cues at clause breaks, no orphan tail", () => {
  const words = "Medimos si la IA te nombra, y te damos arreglos listos para pegar.".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const pieces = partitionWords(words, { ...CAPTION_DEFAULTS, ...PROMO_CAPTIONS });
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].at(-1).text, "nombra,");
  assert.ok(pieces.every((p) => p.length >= 4));
});

test("promoCues: transcript times with the narration's own words", () => {
  const t = buildPromoTimeline({ scenes: [{ id: "a", narration: "El 88% no aparece." }] }, [2]);
  const transcript = [
    { text: "El", start: 0.4, end: 0.5 }, { text: "88%", start: 0.5, end: 1.1 },
    { text: "no", start: 1.1, end: 1.2 }, { text: "aparece.", start: 1.2, end: 1.9 },
  ];
  const [cue] = promoCues(t, { transcript });
  assert.equal(cue.lines.join(" "), "El 88% no aparece.");
  close(cue.words[1].start, 0.5);
});

test("promoLedger: one cut-the-curve LEFT row per seam on the stage wrappers", () => {
  const t = buildPromoTimeline(script, [3, 2.5, 3.2, 2]);
  const l = promoLedger(t);
  assert.equal(l.seams.length, 3);
  l.seams.forEach((s, i) => {
    assert.equal(s.cut, t.scenes[i + 1].start);
    assert.deepEqual(s.exit, { selector: `#stage-${i + 1}`, axis: "x", dir: -1 });
    assert.deepEqual(s.entry, { selector: `#stage-${i + 2}`, axis: "x", dir: -1 });
  });
});

test("checkScript: kinds, required fields, timeline match", () => {
  assert.deepEqual(checkScript(script), []);
  const bad = { scenes: [{ id: "x", kind: "hero" }, { id: "s", kind: "stat" }] };
  const errors = checkScript(bad);
  assert.ok(errors.some((e) => /kind must be/.test(e)) && errors.some((e) => /needs "stat"/.test(e)));
  assert.ok(checkScript(script, { scenes: [{ id: "other" }] }).some((e) => /do not match/.test(e)));
});

test("plan.mjs: merges timeline + captions + scenes into params.json and plan.json", async () => {
  const run = tmp();
  const assets = join(run, "project", "_shared", "assets");
  await voiceover({ scriptPath: SCRIPT, outDir: assets, captionOnly: true });
  // A mix on disk makes the plan point deliver at it.
  mkdirSync(join(assets, "vo"), { recursive: true });
  writeFileSync(join(assets, "vo", "mix.wav"), "");
  const tl = JSON.parse(readFileSync(join(assets, "timeline.json"), "utf8"));
  writeFileSync(join(assets, "timeline.json"), JSON.stringify({ ...tl, mix: "vo/mix.wav" }));
  writeFileSync(join(run, "plan.json"), JSON.stringify({ targets: ["landscape"], copy: { legal: "keep me" } }));

  const { params, plan } = planPromo({ scriptPath: SCRIPT, runDir: run, captionStyle: "karaoke" });
  const onDisk = JSON.parse(readFileSync(join(run, "params.json"), "utf8"));
  assert.deepEqual(onDisk, params);
  assert.equal(params.scenes.length, 4);
  assert.equal(params.scenes[2].stat, "88%");
  assert.equal(params.scenes[0].headline, "¿La IA *recomienda* tu negocio?");
  assert.equal(params.scenes[1].start, tl.scenes[1].start);
  assert.equal(params.duration, tl.duration);
  assert.equal(params.timeline.scenes.length, 4);
  assert.ok(params.captions.length >= 4 && params.captions.every((c) => Array.isArray(c.lines) && Array.isArray(c.words)));
  assert.equal(params.voSrc, "assets/vo/mix.wav");
  assert.equal(params.captionStyle, "karaoke");
  assert.equal(params.ledger.seams.length, 3);

  assert.equal(plan.mode, "promo");
  assert.deepEqual(plan.audio, {
    mix: "project/_shared/assets/vo/mix.wav", vo: null, music: null,
    captions: "project/_shared/assets/captions.json", captionsSrt: "project/_shared/assets/captions.srt", captionsVtt: "project/_shared/assets/captions.vtt",
    language: "es",
  });
  assert.equal(plan.copy.headline, "Estar primero en Google ya no alcanza.");
  assert.equal(plan.copy.cta, "example.com");
  assert.equal(plan.copy.legal, "keep me");
  assert.deepEqual(plan.targets, ["landscape"]);
  assert.equal(plan.scenes[2].route, "sequenced UI life");
  assert.equal(plan.scenes[0].carrier, "#stage-1");
});

test("plan.mjs: caption-only run has no mix and no preview audio", async () => {
  const run = tmp();
  const assets = join(run, "project", "_shared", "assets");
  await voiceover({ scriptPath: SCRIPT, outDir: assets, captionOnly: true });
  const { params, plan } = planPromo({ scriptPath: SCRIPT, runDir: run });
  assert.equal(params.voSrc, null);
  assert.equal(plan.audio.mix, null);
  assert.equal(mergePlan({}, { script, timeline: params.timeline, runDir: run, assetsDir: assets, hasMix: false }).copy.headline, "Estar primero en Google ya no alcanza.");
});

test("templates: promo/vertical shares the landscape composition", () => {
  const l = loadTemplate("promo/landscape"), v = loadTemplate("promo/vertical");
  assert.equal(v.html, l.html);
  assert.equal(l.meta.kind, "motion");
  assert.deepEqual(v.meta.targets, ["reels", "tiktok", "shorts", "stories"]);
  assert.deepEqual(l.meta.targets, ["yt-landscape", "linkedin-video", "x-video", "landscape"]);
  assert.match(l.html, /<audio id="vo"/);
});

test("seams gate: finds per-target ledgers beside each index", () => {
  const run = tmp();
  for (const t of ["landscape", "reels", "_shared"]) mkdirSync(join(run, "project", t), { recursive: true });
  for (const t of ["landscape", "reels"]) writeFileSync(join(run, "project", t, "index.html"), "");
  writeFileSync(join(run, "project", "landscape", "ledger.json"), "{}");
  assert.deepEqual(ledgers(run).map((l) => l.name), ["landscape"]);
  writeFileSync(join(run, "project", "ledger.json"), "{}");
  assert.deepEqual(ledgers(run).map((l) => l.name), [null]);
});

test("plan.mjs: a capture scene's image is copied into assets under its own name", async () => {
  const run = tmp();
  const assets = join(run, "project", "_shared", "assets");
  mkdirSync(join(run, "crops"), { recursive: true });
  writeFileSync(join(run, "crops", "decision.png"), "png");
  const withCapture = { ...script, scenes: [script.scenes[0], { id: "shot", kind: "capture", image: "crops/decision.png", narration: "Mirá la decisión con su traza." }, ...script.scenes.slice(1)] };
  const scriptPath = join(run, "script.json");
  writeFileSync(scriptPath, JSON.stringify(withCapture));
  await voiceover({ scriptPath, outDir: assets, captionOnly: true });
  const { params } = planPromo({ scriptPath, runDir: run });
  assert.equal(params.scenes[1].image, "assets/decision.png");
  assert.ok(existsSync(join(assets, "decision.png")));
});
