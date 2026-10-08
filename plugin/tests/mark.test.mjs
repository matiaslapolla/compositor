import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENERATORS, listGenerators } from "../scripts/mark/generators/index.mjs";
import { composeMark, buildMark, monoVariant, constructionVariant, wordmark, lockup, resolveParams } from "../scripts/mark/compose.mjs";
import { parsePath, flattenPath, ringArea } from "../scripts/mark/geom.mjs";
import { difference, union, geomArea, measure, toGeom } from "../scripts/mark/generators/boolean.mjs";
import { smoothRectPath, lamePath } from "../scripts/mark/generators/container.mjs";
import { vogel } from "../scripts/mark/generators/phyllotaxis.mjs";
import { trochoidPoints, trochoidPeriod } from "../scripts/mark/generators/trochoid.mjs";
import { dft, reconstruct, samplesOf } from "../scripts/mark/generators/fourier.mjs";
import { buildPackage, packIco, framedSvg } from "../scripts/mark/package.mjs";
import * as gate from "../scripts/gates/logo-gate.mjs";
import { loadSharp } from "../scripts/lib/browser.mjs";

const BRAND = {
  identity: { name: "Fixture" },
  color: {
    roles: {
      light: { bg: { hex: "#f6f3ec" }, fg: { hex: "#16201a" }, accent: { hex: "#1f6b45" }, muted: { hex: "#5e6660" }, border: { hex: "#dcd5c6" }, surface: { hex: "#efeadf" } },
      dark: { bg: { hex: "#0f1411" }, fg: { hex: "#eef0ea" }, accent: { hex: "#5fc08a" } },
    },
  },
};
const allPoints = (d, tol = 0.5) => flattenPath(d, tol).flatMap((r) => r.points);

test("registry lists every family with documented defaults", () => {
  const names = listGenerators().map((g) => g.name);
  assert.deepEqual(names, ["container", "grid", "monogram", "boolean", "metaball", "phyllotaxis", "trochoid", "isometric", "voronoi", "truchet", "fourier"]);
  for (const g of listGenerators()) for (const [k, p] of Object.entries(g.params)) assert.ok(p.doc, `${g.name}.${k} has a doc`);
});

test("determinism: same spec and seed give the identical SVG string", () => {
  for (const name of Object.keys(GENERATORS)) {
    const spec = { generator: name, seed: 7 };
    assert.equal(composeMark(spec, BRAND), composeMark(spec, BRAND), name);
  }
  const a = composeMark({ generator: "voronoi", seed: 1 }, BRAND), b = composeMark({ generator: "voronoi", seed: 2 }, BRAND);
  assert.notEqual(a, b, "the seed changes seeded families");
});

test("every generator yields closed paths inside the viewBox", () => {
  for (const [name, g] of Object.entries(GENERATORS)) {
    const out = g.generate({}, 3);
    assert.equal(out.viewBox, "0 0 1000 1000");
    const painted = out.elements.filter((e) => e.fill !== "none");
    assert.ok(painted.length, `${name} paints something`);
    for (const e of painted) {
      const subs = parsePath(e.d);
      assert.ok(subs.length, `${name} has subpaths`);
      assert.ok(subs.every((s) => s.closed), `${name}: every subpath ends with Z`);
      for (const [x, y] of allPoints(e.d)) assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 1000, `${name}: (${x}, ${y}) inside`);
    }
    assert.ok(out.meta.construction.every((c) => c.type === "circle" || c.type === "line"), `${name} construction types`);
  }
});

test("smooth container with ξ = 0.6, R = 200 stays inside [0, 1000]", () => {
  const d = smoothRectPath(0, 0, 1000, 1000, 200, 0.6);
  const pts = allPoints(d, 0.05);
  assert.ok(pts.every(([x, y]) => x >= -1e-6 && x <= 1000 + 1e-6 && y >= -1e-6 && y <= 1000 + 1e-6));
  const out = GENERATORS.container.generate({ size: 1000, radius: 200, smoothing: 0.6 });
  assert.ok(allPoints(out.elements[0].d, 0.05).every(([x, y]) => x >= -1e-6 && x <= 1000 + 1e-6 && y >= -1e-6 && y <= 1000 + 1e-6));
  // The smoothed corner reaches (1 + ξ)·R along each edge: the edge is straight between.
  assert.ok(pts.some(([x, y]) => Math.abs(y) < 1e-6 && Math.abs(x - 320) < 0.5));
});

test("Lamé superellipse with n = 2 is a circle (radius error < 0.5%)", () => {
  const pts = allPoints(lamePath(500, 500, 300, 300, 2), 0.05);
  const err = Math.max(...pts.map(([x, y]) => Math.abs(Math.hypot(x - 500, y - 500) - 300) / 300));
  assert.ok(err < 0.005, `max radius error ${err}`);
});

test("boolean difference of two overlapping squares has the expected area", () => {
  const sq = (x, y, s) => `M${x} ${y}H${x + s}V${y + s}H${x}Z`;
  const g = difference(sq(100, 100, 400), sq(300, 300, 400));
  assert.ok(Math.abs(geomArea(g) - 120000) / 120000 < 0.01);
  assert.ok(Math.abs(geomArea(union(sq(100, 100, 400), sq(300, 300, 400))) - 280000) / 280000 < 0.01);
  const ring = toGeom("M0 0H100V100H0ZM25 25H75V75H25Z", "evenodd");
  assert.ok(Math.abs(geomArea(ring) - 7500) < 1);
});

test("phyllotaxis keeps the requested number of points", () => {
  assert.equal(vogel(89, 10).length, 89);
  for (const count of [21, 55, 144]) {
    const out = GENERATORS.phyllotaxis.generate({ count, clip: "drop" });
    assert.equal(out.meta.points, count, `circle fit keeps all ${count}`);
    assert.equal(parsePath(out.elements[0].d).length, count);
  }
});

test("trochoids and roses close over their exact period", () => {
  for (const p of [
    { curve: "hypotrochoid", R: 5, r: 3, d: 2 },
    { curve: "epitrochoid", R: 7, r: 2, d: 1 },
    { curve: "rose", p: 3, q: 2 },
    { curve: "rose", p: 2, q: 1 },
  ]) {
    const pts = trochoidPoints(p);
    const [a, b] = [pts[0], pts.at(-1)];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `${JSON.stringify(p)} closes`);
  }
  assert.ok(Math.abs(trochoidPeriod({ curve: "hypotrochoid", R: 5, r: 3 }) - 6 * Math.PI) < 1e-12);
  assert.ok(Math.abs(trochoidPeriod({ curve: "rose", p: 3, q: 2 }) - 4 * Math.PI) < 1e-12);
  assert.ok(Math.abs(trochoidPeriod({ curve: "rose", p: 3, q: 1 }) - Math.PI) < 1e-12);
});

test("fourier with every harmonic reproduces the input", () => {
  const input = samplesOf({ points: [[200, 200], [800, 250], [700, 800], [260, 700]] }, 64);
  const back = reconstruct(dft(input), 32, 64);
  const err = Math.max(...input.map(([x, y], i) => Math.hypot(x - back[i][0], y - back[i][1])));
  assert.ok(err < 1e-6, `max error ${err}`);
  const out = GENERATORS.fourier.generate({ d: "M200 200L800 250L700 800L260 700Z", harmonics: 512, samples: 64 });
  const e2 = Math.max(...out.meta.samples.map(([x, y], i) => Math.hypot(x - input[i][0], y - input[i][1])));
  assert.ok(e2 < 0.01, `generator error ${e2}`);
});

test("monoVariant leaves exactly one paint", () => {
  const svg = composeMark({ generator: "isometric" }, BRAND);
  assert.equal(new Set(gate.paints(svg)).size, 3, "isometric uses three tones");
  const mono = monoVariant(svg, "#000");
  assert.deepEqual(gate.paints(mono), ["#000000"]);
});

test("optical centring moves a triangle's centroid to the biased centre", () => {
  const spec = { generator: "fourier", params: { points: [[120, 120], [520, 120], [120, 520]], harmonics: 512, samples: 96 }, optical: { centre: true, bias: 0.02 } };
  const { svg, meta } = buildMark(spec, BRAND);
  const d = svg.match(/ d="([^"]+)"/)[1];
  const m = measure([{ d, fill: "#000" }]);
  const target = { x: 500, y: 500 - 0.02 * m.bbox.height };
  assert.ok(Math.hypot(m.centroid.x - target.x, m.centroid.y - target.y) < 10, `centroid ${JSON.stringify(m.centroid)}`);
  assert.ok(Math.abs(meta.centroid.x - 500) < 10 && Math.abs(meta.centroid.y - 500) < 20);
});

test("compose resolves roles and shades, emits paths only, rejects bad params", () => {
  const svg = composeMark({ generator: "isometric", colors: { mode: "light" } }, BRAND);
  assert.match(svg, /viewBox="0 0 1000 1000"/);
  assert.ok(svg.includes('fill="#1f6b45"'));
  assert.deepEqual(gate.forbiddenTags(svg), []);
  assert.ok(!/<(?!\/?(svg|path)\b)/.test(svg.replace(/<\?xml[^>]*>/, "")), "only svg and path elements");
  const dark = composeMark({ generator: "container", colors: { mode: "dark" } }, BRAND);
  assert.ok(dark.includes('fill="#5fc08a"'));
  assert.throws(() => composeMark({ generator: "nope" }, BRAND), /unknown generator/);
  assert.throws(() => resolveParams(GENERATORS.container, { shape: "blob" }), /must be one of/);
  assert.throws(() => resolveParams(GENERATORS.container, { colour: 1 }), /has no param/);
  const layered = buildMark({ generator: "container", layers: [{ generator: "monogram", params: { letters: "A" }, op: "difference" }] }, BRAND);
  assert.ok(layered.meta.area < buildMark({ generator: "container" }, BRAND).meta.area);
  const cons = constructionVariant(composeMark({ generator: "grid" }, BRAND), layered.meta, { color: "#ff0000" });
  assert.match(cons, /opacity="0.4"/);
});

test("wordmark fails cleanly without a usable font", () => {
  assert.throws(() => wordmark("Orbit", undefined), /no font file given/);
  assert.throws(() => wordmark("Orbit", "/nonexistent/font.ttf"), /font file not found: \/nonexistent\/font.ttf/);
  const dir = mkdtempSync(join(tmpdir(), "mark-font-"));
  try {
    const fake = join(dir, "brand.woff2");
    writeFileSync(fake, "wOF2");
    assert.throws(() => wordmark("Orbit", fake), /WOFF2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => lockup(composeMark({ generator: "container" }, BRAND), '<svg viewBox="0 0 10 10"><path d="M0 0H1V1Z"/></svg>'), /data-cap-height/);
});

test("logo-gate measures 16 px stroke, 32 px counters and the maskable zone", async () => {
  const thick = composeMark({ generator: "container" }, BRAND);
  const thin = composeMark({ generator: "trochoid", params: { curve: "hypotrochoid", R: 5, r: 3, d: 2, render: "stroke", weight: 24 } }, BRAND);
  assert.equal((await gate.strokeSurvival(thick)).pass, true);
  assert.equal((await gate.strokeSurvival(thin)).pass, false);

  const ring = composeMark({ generator: "container", params: { ring: 120 } }, BRAND);
  const cc = await gate.counterCheck(ring);
  assert.equal(cc.counters, 1);
  assert.equal(cc.pass, true);
  const pinhole = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000"><path fill-rule="evenodd" fill="#000" d="M100 100H900V900H100ZM480 480H515V515H480Z"/></svg>';
  assert.equal((await gate.counterCheck(pinhole)).pass, false, "a 1.1 px counter at 32 px fails");

  const sharp = loadSharp();
  const icon = (r) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#ffffff"/><circle cx="256" cy="256" r="${r}" fill="#000"/></svg>`)).png().toBuffer();
  assert.equal((await gate.maskableSafe(await icon(190))).pass, true);
  assert.equal((await gate.maskableSafe(await icon(240))).pass, false);
  const framed = await sharp(Buffer.from(framedSvg(thick, { size: 512, ratio: 0.38, fit: "radius", bg: "#ffffff" }))).png().toBuffer();
  assert.equal((await gate.maskableSafe(framed)).pass, true);

  const a = gate.luma(await gate.rasterize(thick, 16));
  assert.equal(gate.ssim(a, a, 16, 16), 1);
  const off = await gate.centroidOffset(composeMark({ generator: "fourier" }, BRAND));
  assert.ok(off.max > 0.04, "a triangle's centroid sits below its bbox centre");
  assert.deepEqual(gate.forbiddenTags('<svg><linearGradient/><path/></svg>'), ["linearGradient"]);
});

test("ICO packing writes a valid ICONDIR with PNG payloads", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const ico = packIco([{ size: 16, png }, { size: 256, png }]);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(6 + 16), 0, "256 is stored as 0");
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 32);
  assert.equal(ico.readUInt32LE(6 + 16 + 12), 6 + 32 + png.length);
});

test("package without browser or wordmark passes the measurable logo rules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mark-pkg-"));
  try {
    const manifest = await buildPackage({ spec: { generator: "monogram", params: { letters: "S", container: "squircle" } }, brand: BRAND, out: join(dir, "pkg"), browser: false });
    assert.ok(manifest.files.some((f) => f.path === "web/favicon.ico" && f.bytes > 0));
    const { findings } = await gate.checkPackage(join(dir, "pkg"));
    const by = Object.fromEntries(findings.map((f) => [f.rule, f]));
    for (const rule of ["logo.stroke-16", "logo.counter-32", "logo.no-gradients", "logo.mono-single-fill", "logo.maskable-safe", "logo.centroid", "logo.ssim-16"]) {
      assert.equal(by[rule].status, "pass", `${rule}: ${by[rule].evidence}`);
    }
    const result = await gate.run({ runDir: dir, plan: { mark: { outDir: "pkg" } } });
    assert.equal(result.gate, "logo-gate");
    assert.equal(result.status, "warn", "wordmark and lockups are declared skipped without a font: a warning, not a failure");
    assert.deepEqual(result.findings.map((f) => f.rule), ["logo.files"]);
    assert.match(result.findings[0].evidence, /wordmark\.svg/);
    assert.ok(result.findings[0].hint, "hint comes from references/gates.md");
    assert.ok(result.metrics.ssim16 > 0.9 && result.metrics.stroke16.worstKept >= 0.85);
    assert.equal((await gate.run({})).status, "skip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
