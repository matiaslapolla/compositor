import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGETS, TARGET_NAMES, target, safeBox, targetsFor, FORMATS, DEFAULT_FORMATS, CRF, AUDIO_DEFAULT } from "../scripts/targets/presets.mjs";
import { encodeArgs, stillArgs, bitrateForCap, crfFor, pingPongOrder, encodePlan } from "../scripts/targets/encode.mjs";

const FIXED = TARGET_NAMES.filter((n) => TARGETS[n].width != null);
const MOTION = TARGET_NAMES.filter((n) => ["motion", "both"].includes(TARGETS[n].kind));
const mp4 = (extra = {}) => encodeArgs("mp4", { input: "frames/frame_%06d.png", output: "out.mp4", fps: 30, width: { w: 1080, h: 1920 }, ...extra });
const after = (args, flag) => args[args.indexOf(flag) + 1];

test("every base and research target is defined", () => {
  const expected = ["still", "brand", "ig-feed", "ig-square", "reels", "stories", "tiktok", "shorts", "landscape", "linkedin-square", "x-image", "linkedin-image", "producthunt", "dribbble", "behance-cover",
    "reels-ad", "stories-ad", "tiktok-ad", "shorts-ad", "yt-thumbnail", "yt-landscape", "x-video", "x-square", "x-landscape-image", "linkedin-portrait", "linkedin-video", "linkedin-document",
    "gda-landscape", "gda-square", "gda-portrait", "gda-logo-square", "gda-logo-landscape", "pinterest-pin", "threads-image", "threads-video", "bluesky-image", "bluesky-video", "og-image", "avatar", "app-store-screenshot", "favicon"];
  for (const n of expected) assert.ok(TARGETS[n], n);
  assert.equal(TARGET_NAMES.length, expected.length);
});

test("fixed targets have a positive canvas and a non-negative safe box inside the frame", () => {
  for (const n of FIXED) {
    const t = TARGETS[n];
    assert.ok(t.width > 0 && t.height > 0, n);
    assert.equal(t.safe.length, 4, n);
    for (const f of t.safe) assert.ok(f >= 0 && f < 0.5, `${n} inset ${f}`);
    const b = safeBox(n);
    assert.ok(b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0, n);
    assert.ok(b.x + b.w <= t.width && b.y + b.h <= t.height, n);
    assert.ok(["social", "ad", "video", "brand", "web"].includes(t.group), n);
    assert.ok(t.platform && t.note, n);
  }
});

test("scene-sized targets take their canvas from the caller", () => {
  assert.deepEqual(safeBox("still", { width: 1000, height: 500 }), { x: 0, y: 0, w: 1000, h: 500 });
  assert.throws(() => safeBox("brand"), /no fixed canvas/);
});

test("motion targets have duration and fps; stills and pages have no duration", () => {
  for (const n of MOTION) {
    const t = TARGETS[n];
    assert.ok(t.fps >= 24 && t.fps <= 60, n);
    assert.ok(t.duration.min > 0 && t.duration.min <= t.duration.ideal && t.duration.ideal <= t.duration.max, n);
    assert.ok(t.bitrateKbps.target <= t.bitrateKbps.max, n);
    assert.deepEqual(t.loudness, { lufs: -14, truePeak: -1, lra: 11 }, n);
  }
  for (const n of TARGET_NAMES.filter((n) => ["still", "page"].includes(TARGETS[n].kind))) {
    assert.equal(TARGETS[n].duration, undefined, n);
    assert.equal(TARGETS[n].fps, undefined, n);
  }
});

test("safeBox(reels) matches the reels insets", () => {
  assert.deepEqual(safeBox("reels"), { x: 65, y: 220, w: 950, h: 1280 });
  assert.deepEqual(safeBox("reels-ad"), { x: 65, y: 269, w: 950, h: 979 });
  assert.deepEqual(safeBox("yt-thumbnail"), { x: 160, y: 90, w: 960, h: 540 });
});

test("organic reels keep their numbers while reels-ad is tighter at the bottom", () => {
  assert.ok(TARGETS["reels-ad"].safe[2] > TARGETS.reels.safe[2]);
  assert.equal(TARGETS.tiktok.safe[2], 320 / 1920);
});

test("research sizes and caps", () => {
  assert.deepEqual([TARGETS["app-store-screenshot"].width, TARGETS["app-store-screenshot"].height], [1290, 2796]);
  assert.equal(TARGETS["gda-landscape"].maxBytes, 5120 * 1024);
  assert.deepEqual(TARGETS["gda-square"].text, { shortHeadline: 30, longHeadline: 90, description: 90, businessName: 25 });
  assert.equal(TARGETS["linkedin-document"].kind, "page");
  assert.equal(TARGETS["x-video"].maxBytes, 512e6);
  assert.equal(TARGETS.tiktok.maxBytes, 72e6);
});

test("target() throws and lists the supported names", () => {
  assert.throws(() => target("nope"), (e) => /^Unknown target "nope"\. Supported: /.test(e.message) && e.message.includes("reels-ad") && e.message.includes("favicon"));
});

test("targetsFor groups by kind and includes dual-use targets", () => {
  assert.ok(targetsFor("motion").includes("reels"));
  assert.ok(targetsFor("motion").includes("ig-feed"));
  assert.ok(targetsFor("still").includes("ig-feed"));
  assert.ok(!targetsFor("still").includes("reels"));
  assert.deepEqual(targetsFor("page"), ["linkedin-document"]);
});

test("formats and defaults", () => {
  assert.equal(FORMATS.webm.alpha, true);
  assert.equal(FORMATS.mp4.alpha, false);
  assert.deepEqual(DEFAULT_FORMATS.motion, ["mp4"]);
  assert.deepEqual(DEFAULT_FORMATS.page, ["png", "pdf"]);
  assert.deepEqual(CRF, { brand: 18, tutorial: 18, social: 18, ad: 20, capped: 23 });
  assert.equal(AUDIO_DEFAULT.lufs, -14);
});

test("mp4 carries the BT.709 tags, yuv420p, faststart and a GOP of fps/2", () => {
  const a = mp4({ crf: 20 });
  const joined = a.join(" ");
  assert.ok(joined.includes("-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"));
  assert.equal(after(a, "-pix_fmt"), "yuv420p");
  assert.equal(after(a, "-movflags"), "+faststart");
  assert.equal(after(a, "-g"), "15");
  assert.equal(after(a, "-keyint_min"), "15");
  assert.equal(after(a, "-bf"), "2");
  assert.equal(after(a, "-sc_threshold"), "0");
  assert.equal(after(a, "-preset"), "slow");
  assert.equal(after(a, "-profile:v"), "high");
  assert.equal(after(a, "-level:v"), "4.1");
  assert.equal(after(a, "-crf"), "20");
  assert.ok(after(a, "-vf").includes("trunc(iw/2)*2:trunc(ih/2)*2"));
  assert.ok(after(a, "-vf").includes("setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709"));
  assert.equal(after(a, "-map_metadata"), "-1");
  assert.ok(a.includes("-an"));
  assert.equal(a.at(-1), "out.mp4");
  assert.equal(after(mp4({ fps: 60 }), "-g"), "30");
});

test("h264 level rises with frame rate and size", () => {
  assert.equal(after(mp4({ fps: 60, width: { w: 1920, h: 1080 } }), "-level:v"), "4.2");
  assert.equal(after(mp4({ width: { w: 3840, h: 2160 } }), "-level:v"), "5.1");
});

test("audio flags appear only with audio", () => {
  const silent = mp4();
  assert.ok(!silent.includes("-c:a") && !silent.includes("-shortest"));
  const a = mp4({ audio: "mix.wav", loudnormFilter: "loudnorm=I=-14" });
  assert.equal(after(a, "-c:a"), "aac");
  assert.equal(after(a, "-b:a"), "192k");
  assert.equal(after(a, "-ar"), "48000");
  assert.equal(after(a, "-ac"), "2");
  assert.equal(after(a, "-af"), "loudnorm=I=-14");
  assert.ok(a.includes("-shortest"));
  assert.ok(!a.includes("-an"));
  assert.equal(a.filter((x) => x === "-i").length, 2);
  assert.ok(!mp4({ audio: "mix.wav" }).includes("-af"));
});

test("youtube profile uses 384k audio", () => {
  assert.equal(after(mp4({ audio: "mix.wav", profile: "youtube" }), "-b:a"), "384k");
  assert.equal(after(mp4({ audio: "mix.wav", profile: "capped" }), "-b:a"), "192k");
});

test("bitrate mode replaces CRF and supports two-pass", () => {
  const a = mp4({ bitrateKbps: 10000, maxrateKbps: 12000 });
  assert.ok(!a.includes("-crf"));
  assert.equal(after(a, "-b:v"), "10000k");
  assert.equal(after(a, "-maxrate"), "12000k");
  assert.equal(after(a, "-bufsize"), "24000k");
  const p1 = mp4({ bitrateKbps: 5000, pass: 1, passlog: "pl" });
  assert.equal(after(p1, "-pass"), "1");
  assert.equal(after(p1, "-passlogfile"), "pl");
  assert.deepEqual(p1.slice(-4), ["-an", "-f", "null", "-"]);
  assert.equal(p1.at(-1), "-");
  assert.ok(!p1.includes("out.mp4"));
  assert.equal(mp4({ bitrateKbps: 5000, pass: 2, passlog: "pl" }).at(-1), "out.mp4");
});

test("background flattens through a filter graph", () => {
  const a = mp4({ background: "#101820", audio: "mix.wav" });
  const graph = after(a, "-filter_complex");
  assert.ok(graph.startsWith("color=c=0x101820:s=1080x1920:r=30[bg];[bg][0:v]overlay"));
  assert.ok(graph.endsWith("[v]"));
  assert.equal(a.filter((x) => x === "-map").length, 2);
  assert.equal(after(a, "-map"), "[v]");
  assert.ok(a.includes("1:a:0"));
});

test("alpha formats follow the base presets", () => {
  const base = { input: "f_%06d.png", output: "o", fps: 30, width: { w: 10, h: 10 } };
  assert.ok(encodeArgs("webm", base).includes("libvpx-vp9"));
  assert.equal(after(encodeArgs("mov", base), "-pix_fmt"), "yuva444p10le");
  assert.ok(encodeArgs("webp", base).includes("libwebp_anim"));
  assert.equal(after(encodeArgs("apng", base), "-f"), "apng");
  assert.throws(() => encodeArgs("png-sequence", base), /no encoder/);
});

test("gif is two-pass and the second pass reads the palette", () => {
  const base = { input: "f_%06d.png", fps: 30, width: { w: 10, h: 10 }, gifFps: 12, gifWidth: 480 };
  const p1 = encodeArgs("gif-palette", { ...base, output: "pal.png" });
  assert.ok(after(p1, "-vf").includes("palettegen"));
  assert.ok(after(p1, "-vf").includes("fps=12,scale=480:-1"));
  assert.equal(p1.at(-1), "pal.png");
  const p2 = encodeArgs("gif", { ...base, output: { palette: "pal.png", file: "o.gif" } });
  assert.ok(p2.indexOf("pal.png") === p2.indexOf("-i", p2.indexOf("-i") + 1) + 1);
  assert.ok(after(p2, "-lavfi").includes("paletteuse"));
  assert.equal(p2.at(-1), "o.gif");
});

test("stillArgs converts one PNG and flattens when asked", () => {
  const png = stillArgs({ input: "a.png", output: "a.png" });
  assert.ok(!png.includes("-filter_complex"));
  assert.ok(png.includes("-frames:v"));
  const jpg = stillArgs({ input: "a.png", output: "a.jpg", quality: 80 });
  assert.ok(after(jpg, "-filter_complex").includes("color=0xffffff"));
  assert.equal(after(jpg, "-q:v"), "8");
  const webp = stillArgs({ input: "a.png", output: "a.webp", background: "#000000" });
  assert.ok(after(webp, "-filter_complex").includes("color=0x000000"));
  assert.equal(after(webp, "-c:v"), "libwebp");
  assert.throws(() => stillArgs({ input: "a.png", output: "a.gif" }), /no still encoder/);
});

test("bitrateForCap leaves headroom under the cap", () => {
  assert.equal(bitrateForCap(72e6, 30), 17472);
  assert.equal(bitrateForCap(72e6, 30, 128), 17536);
  for (const [cap, d] of [[72e6, 30], [72e6, 120], [100e6, 180], [200e6, 600]]) {
    const kbps = bitrateForCap(cap, d);
    assert.ok(((kbps + 192) * 125 * d) < cap, `${cap}/${d}`);
  }
});

test("crfFor follows the ladder", () => {
  assert.equal(crfFor("ad"), 20);
  assert.equal(crfFor("brand"), 18);
  assert.equal(crfFor("social", "tiktok"), 23);
  assert.equal(crfFor("social", TARGETS["x-video"]), 18);
  assert.equal(crfFor("ad", "tiktok"), 20);
  assert.equal(crfFor("tutorial", "yt-landscape"), 18);
});

test("pingPongOrder drops the turning points", () => {
  assert.deepEqual(pingPongOrder(4), [1, 2, 3, 4, 3, 2]);
  assert.deepEqual(pingPongOrder(1), [1]);
});

test("encodePlan picks a bitrate under the TikTok cap", () => {
  const p = encodePlan("tiktok", { durationS: 30 });
  assert.equal(p.format, "mp4");
  assert.equal(p.crf, null);
  assert.equal(p.profile, "capped");
  assert.equal(p.audioKbps, 192);
  assert.ok(p.bitrateKbps > 0 && (p.bitrateKbps + p.audioKbps) * 125 * 30 < 72e6);
  const long = encodePlan("tiktok", { durationS: 600 });
  assert.ok((long.bitrateKbps + 192) * 125 * 600 < 72e6);
  assert.throws(() => encodePlan("tiktok", { durationS: 3600 }), /does not fit/);
});

test("encodePlan uses CRF for uncapped targets and the YouTube profile for YouTube", () => {
  const ig = encodePlan("ig-square", { durationS: 15 });
  assert.deepEqual([ig.crf, ig.bitrateKbps, ig.profile], [18, null, "social"]);
  assert.equal(encodePlan("reels-ad", { durationS: 15 }).crf, 20);
  const yt = encodePlan("yt-landscape", { durationS: 120 });
  assert.deepEqual([yt.crf, yt.bitrateKbps, yt.maxrateKbps, yt.profile, yt.audioKbps], [null, 10000, 12000, "youtube", 384]);
  assert.equal(encodePlan("yt-landscape", { audio: false }).audioKbps, 0);
});

test("encodePlan switches to bitrate when the guidance ceiling would overshoot the cap", () => {
  const short = encodePlan("linkedin-video", { durationS: 20 });
  assert.equal(short.crf, 18);
  const long = encodePlan("linkedin-video", { durationS: 600 });
  assert.equal(long.crf, null);
  assert.ok((long.bitrateKbps + 192) * 125 * 600 < 200e6);
  assert.throws(() => encodePlan("x-image"), /not a motion target/);
});

test("every motion target has a plan at its ideal duration", () => {
  for (const n of MOTION) {
    const p = encodePlan(n);
    assert.ok(p.crf != null || p.bitrateKbps > 0, n);
  }
});
