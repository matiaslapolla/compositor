import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, listTemplates, loadTemplate, fill, checkParams } from "../scripts/render/build.mjs";
import { TARGETS } from "../scripts/targets/presets.mjs";

const KINDS = ["still", "motion", "both", "page"];
const templates = listTemplates();

// The first ```json block of a template's README is its example params.json.
function readmeExample(id) {
  const path = join(TEMPLATES_DIR, id, "README.md");
  if (!existsSync(path)) return null;
  const block = readFileSync(path, "utf8").match(/```json\n([\s\S]*?)\n```/);
  return block ? JSON.parse(block[1]) : null;
}

// The same data shape build.mjs hands to fill(), without a brand on disk.
function dataFor(meta, params, item, index, count) {
  const scoped = item ? { ...params, ...item, slide: { ...item, index, count } } : params;
  const kind = meta.kind === "motion" ? "motion" : "still";
  return {
    ...scoped, copy: scoped, json: JSON.stringify(scoped),
    brand: { name: "Fixture", tagline: "" },
    target: { name: meta.targets[0], ...TARGETS[meta.targets[0]], kind },
    canvas: "dark", still: kind === "still", motion: kind === "motion",
    duration: meta.duration ?? 1, fps: meta.fps ?? 30,
    logo: { mark: "assets/logo-mark.png" },
  };
}

test("templates are found under templates/", () => {
  assert.ok(templates.length >= 6);
  for (const id of ["social/claim", "ad/static-ad", "ad/bumper-6s", "ad/reels-ad-15s", "ad/carousel", "ad/end-card"]) {
    assert.ok(templates.some((t) => t.id === id), id);
  }
});

for (const t of templates) {
  test(`${t.id}: template.json has name, mode, kind, params and known targets`, () => {
    assert.equal(t.name, t.id);
    assert.equal(t.mode, t.id.split("/")[0]);
    assert.ok(KINDS.includes(t.kind), t.kind);
    assert.equal(typeof t.params, "object");
    assert.ok(Object.keys(t.params).length > 0);
    for (const [key, rule] of Object.entries(t.params)) {
      if (rule.enum && rule.default !== undefined) assert.ok(rule.enum.includes(rule.default), `${key} default outside enum`);
    }
    assert.ok(Array.isArray(t.targets) && t.targets.length > 0);
    for (const name of t.targets) assert.ok(TARGETS[name], `unknown target ${name}`);
    if (t.kind === "motion") assert.ok(t.duration > 0 && t.fps > 0);
  });

  test(`${t.id}: the README example passes checkParams and fills every placeholder`, (ctx) => {
    const example = readmeExample(t.id);
    if (!example) return ctx.skip("no README example");
    const tpl = loadTemplate(t.id);
    const { params, errors } = checkParams(tpl.meta, example);
    assert.deepEqual(errors, []);
    const items = tpl.meta.instances ? params[tpl.meta.instances] : [null];
    assert.ok(Array.isArray(items) && items.length > 0, `params.${tpl.meta.instances} is a non-empty array`);
    items.forEach((item, i) => {
      const html = fill(tpl.html, dataFor(tpl.meta, params, item, i + 1, items.length));
      assert.doesNotMatch(html, /\{\{[#^/]?[\w.]+(\|[^}]*)?\}\}/, "unfilled placeholder");
      assert.match(html, /data-composition-id="main"/);
      assert.match(html, /window\.__timelines\["main"\]/);
      assert.doesNotMatch(html, /<br\s*\/?>/i);
    });
  });
}

test("ad templates ship a README with an example", () => {
  for (const t of templates.filter((x) => x.mode === "ad")) assert.ok(readmeExample(t.id), t.id);
});

test("checkParams rejects an over-long ad headline and a missing CTA", () => {
  const { meta } = loadTemplate("ad/static-ad");
  const { errors } = checkParams(meta, { headline: "one two three four five six seven eight" });
  assert.ok(errors.some((e) => e.startsWith("headline: more than 7 words")));
  assert.ok(errors.includes("cta: required"));
});

test("carousel slides fill per slide: number chip and slide headline", () => {
  const tpl = loadTemplate("ad/carousel");
  const { params } = checkParams(tpl.meta, readmeExample("ad/carousel"));
  const html = fill(tpl.html, dataFor(tpl.meta, params, params.slides[2], 3, params.slides.length));
  assert.match(html, /3 \/ 6/);
  assert.match(html, /Hacemos las preguntas que haría tu cliente/);
  assert.match(html, /data-index="3" data-count="6"/);
});

test("a themed logo SVG is settled for the canvas, not the renderer's colour scheme", async () => {
  const { svgForCanvas } = await import("../scripts/render/build.mjs");
  const svg = '<svg><style>.s{stroke:#141618}@media(prefers-color-scheme:dark){.s{stroke:#edeff0}.a{fill:#21b1b6}}</style><path class="s"/></svg>';
  assert.equal(svgForCanvas(svg, "dark"), '<svg><style>.s{stroke:#141618}.s{stroke:#edeff0}.a{fill:#21b1b6}</style><path class="s"/></svg>');
  assert.equal(svgForCanvas(svg, "light"), '<svg><style>.s{stroke:#141618}</style><path class="s"/></svg>');
  assert.equal(svgForCanvas("<svg><path/></svg>", "dark"), "<svg><path/></svg>");
});

test("fill renders a section nested in an inverted section", () => {
  const tpl = "{{^logo.mono}}{{#logo.mark}}<b>{{{logo.mark}}}</b>{{/logo.mark}}{{/logo.mono}}|{{^off}}{{#audio}}<a src=\"{{audio}}\">{{/audio}}{{/off}}";
  assert.equal(fill(tpl, { logo: { mark: "<svg/>" }, audio: "vo.wav" }), '<b><svg/></b>|<a src="vo.wav">');
  assert.equal(fill(tpl, { logo: { mono: "m", mark: "<svg/>" }, off: true }), "|");
});
