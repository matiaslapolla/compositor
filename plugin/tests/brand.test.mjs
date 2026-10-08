import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveBrand } from "../scripts/brand/resolve.mjs";
import { brandCss, manimTheme } from "../scripts/brand/theme.mjs";
import { readCssVars, resolvedMap } from "../scripts/brand/sources/css.mjs";
import { readDesignMd } from "../scripts/brand/sources/designmd.mjs";
import { normalizeColor, contrast, hexesIn } from "../scripts/lib/color.mjs";
import { rangeFromName } from "../scripts/brand/sources/fonts.mjs";
import { findLogoFiles, classifyLogos } from "../scripts/brand/sources/logos.mjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", name);

test("css parser keeps :root after @import statements and splits dark scopes", () => {
  const { vars } = readCssVars(fx("brand-shadcn"));
  assert.equal(vars.light.get("primary").value, "#263fb8");
  assert.equal(vars.dark.get("primary").value, "#7e93f2");
  const light = resolvedMap(vars, "light");
  assert.equal(light.get("color-primary").value, "#263fb8");
});

test("shadcn repo: primary beats the hover-tint accent, fonts come from next/font", async () => {
  const { brand, errors } = await resolveBrand(fx("brand-shadcn"), { fonts: false });
  assert.deepEqual(errors, []);
  assert.equal(brand.color.roles.light.accent.hex, "#263fb8");
  assert.equal(brand.color.roles.dark.accent.hex, "#7e93f2");
  assert.equal(brand.color.roles.light.surface.hex, "#fbfbfd");
  assert.equal(brand.color.roles.light.muted.hex, "#626878");
  assert.equal(brand.color.mode, "both");
  assert.equal(brand.type.body.family, "Instrument Sans");
  assert.equal(brand.type.display.family, "Instrument Sans");
  assert.equal(brand.type.mono.family, "IBM Plex Mono");
  assert.deepEqual(brand.type.body.stack, ["Instrument Sans"], "a self-referencing --font-sans keeps the next/font family");
  assert.equal(brand.provenance["/color/roles/light/accent"].confidence, "exact");
  assert.equal(brand.provenance["/type/display/family"].confidence, "inferred");
  assert.equal(brand.identity.name, "Acme Fixture");
  assert.ok(brand.warnings.some((w) => /indigo\/violet/.test(w)));
});

test("@theme repo: custom role names, prefers-color-scheme dark, digit-subset font skipped", async () => {
  const { brand, errors } = await resolveBrand(fx("brand-theme"), { fonts: false });
  assert.deepEqual(errors, []);
  assert.equal(brand.color.roles.light.bg.hex, normalizeColor("oklch(0.982 0.002 240)").hex);
  assert.equal(brand.color.roles.dark.bg.hex, normalizeColor("oklch(0.165 0.003 240)").hex);
  assert.equal(brand.color.roles.light.accent.hex, normalizeColor("oklch(0.609 0.098 199)").hex);
  assert.equal(brand.color.roles.light.error.hex, normalizeColor("oklch(0.5 0.2 5)").hex);
  assert.equal(brand.color.roles.light.warning.hex, normalizeColor("oklch(0.8 0.15 85)").hex);
  assert.equal(brand.provenance["/color/roles/light/success"].confidence, "inferred");
  assert.equal(brand.type.body.family, "Text Face");
  assert.deepEqual(brand.type.body.stack, ["Figures", "Text Face"]);
  assert.equal(brand.motion.easing.brand.gsap, "CustomEase:brand");
  assert.deepEqual(brand.motion.easing.brand.bezier, [0.23, 1, 0.32, 1]);
  assert.equal(brand.identity.name, "Orbit");
});

test("DESIGN.md frontmatter wins over CSS and logs the conflict", async () => {
  const { brand, errors } = await resolveBrand(fx("brand-designmd"), { fonts: false });
  assert.deepEqual(errors, []);
  assert.equal(brand.identity.name, "DojoFixture");
  assert.equal(brand.color.roles.light.accent.hex, "#1f4fb8");
  assert.equal(brand.color.roles.dark.accent.hex, "#5f92ea");
  assert.equal(brand.color.roles.light.bg.hex, "#f7f7f5");
  assert.equal(brand.color.roles.light.success.hex, "#16a34a");
  assert.equal(brand.type.display.family, "Manrope");
  assert.deepEqual(brand.voice.tone, ["calm", "capable", "grounded"]);
  assert.ok(brand.conflicts.some((c) => c.pointer === "/color/roles/light/accent" && c.other === "#2f5fc3"));
});

test("DESIGN.md prose tables parse oklch triplets and slash rows", () => {
  const md = readDesignMd(join(here, "fixtures", "designmd-table.md"));
  const byName = Object.fromEntries(md.tables.map((t) => [t.name, t]));
  assert.equal(byName.background.light.hex, normalizeColor("oklch(0.985 0.002 250)").hex);
  assert.equal(byName.success.light.hex, normalizeColor("oklch(0.5 0.12 155)").hex);
  assert.equal(byName.error.dark.hex, normalizeColor("oklch(0.68 0.16 27)").hex);
  assert.equal(byName.highlight.light.hex, normalizeColor("oklch(0.89 0.17 96)").hex);
});

test("brand.css and manim theme derive from brand.json", async () => {
  const { brand } = await resolveBrand(fx("brand-shadcn"), { fonts: false });
  const css = brandCss(brand, { mode: "dark" });
  assert.match(css, /--color-bg: #14161c;/);
  assert.match(css, /--color-accent: #7e93f2;/);
  assert.match(css, /--font-display: "Instrument Sans", system-ui, sans-serif;/);
  assert.match(css, /--ease-enter: cubic-bezier\(0.23, 1, 0.32, 1\);/);
  const theme = manimTheme(brand, { mode: "dark" });
  assert.equal(theme.BG, brand.color.video.nearBlack);
  assert.equal(theme.DATA, "#7e93f2");
});

test("colour helpers", () => {
  assert.equal(normalizeColor("#ABC").hex, "#aabbcc");
  assert.ok(contrast("#000000", "#ffffff") > 20);
  assert.deepEqual(hexesIn("a #fff b oklch(0.2 0 0) c #12345678").sort(), ["#123456", "#ffffff", normalizeColor("oklch(0.2 0 0)").hex].sort());
});

test("subset ranges are inferred from file names", () => {
  assert.match(rangeFromName("Schibsted-400-normal-latin-ext.woff2"), /U\+0100-02BA/);
  assert.match(rangeFromName("Schibsted-400-normal-latin.woff2"), /U\+0000-00FF/);
  assert.equal(rangeFromName("HubotSans-wdth-wght.woff2"), null);
});

test("logos inside monorepo workspace packages are found, a logo outranks a browser icon, a root logo keeps the slot", async () => {
  const root = mkdtempSync(join(tmpdir(), "brand-monorepo-"));
  const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><circle cx="5" cy="5" r="4" fill="#1c9499"/></svg>`;
  try {
    mkdirSync(join(root, "apps", "landing", "public"), { recursive: true });
    writeFileSync(join(root, "apps", "landing", "public", "icon.svg"), svg(98, 98));
    let logos = await classifyLogos(findLogoFiles(root));
    assert.equal(logos.mark.path, join(root, "apps", "landing", "public", "icon.svg"));
    assert.equal(logos.mark.confidence, "low");

    writeFileSync(join(root, "apps", "landing", "public", "logo.svg"), svg(84, 80));
    logos = await classifyLogos(findLogoFiles(root));
    assert.equal(logos.mark.path, join(root, "apps", "landing", "public", "logo.svg"));

    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public", "logo.svg"), svg(10, 10));
    logos = await classifyLogos(findLogoFiles(root));
    assert.equal(logos.mark.path, join(root, "public", "logo.svg"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
