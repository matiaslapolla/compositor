#!/usr/bin/env node
// brand.json resolver: repo → normalized brand with provenance.
//   node resolve.mjs --root <repo> [--out compositor/brand.json] [--refresh] [--no-fonts] [--json]
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve as resolvePath } from "node:path";
import { parseArgs, fail } from "../lib/args.mjs";
import { readJson, writeJson, writeText, ensureDir } from "../lib/fs.mjs";
import { normalizeColor, contrast, deltaE, fromOklch, shift, pickForeground } from "../lib/color.mjs";
import { readCssVars, resolvedMap } from "./sources/css.mjs";
import { findDesignMd, readDesignMd, frontmatterLookups } from "./sources/designmd.mjs";
import { findTokenFiles, readDtcg } from "./sources/dtcg.mjs";
import { findLayoutFiles, readNextFonts, readFontFaces, fontRoles, firstRealFamily, materializeGoogle, materializeLocal, HYPERFRAMES_BUNDLED } from "./sources/fonts.mjs";
import { findLogoFiles, classifyLogos } from "./sources/logos.mjs";
import { assignRoles, ROLE_CANDIDATES } from "./roles.mjs";
import { validateBrand } from "./validate.mjs";

export const HOUSE = {
  motion: {
    fps: 30,
    direction: "left",
    register: "smooth",
    durations: { micro: 0.25, short: 0.45, medium: 0.7, long: 1.1, hold: 0.5 },
    easing: {
      enter: { gsap: "power3.out", bezier: [0.23, 1, 0.32, 1] },
      exit: { gsap: "power3.in", bezier: [0.4, 0, 1, 1] },
      move: { gsap: "power2.inOut", bezier: [0.77, 0, 0.175, 1] },
      scene: { gsap: "expo.inOut", bezier: [0.87, 0, 0.13, 1] },
      ambient: { gsap: "sine.inOut", bezier: [0.37, 0, 0.63, 1] },
    },
    stagger: { each: 0.08, maxTotal: 0.5 },
    exitRatio: 0.75,
    forbidden: ["bounce.out", "elastic.out", "idle-wobble", "crossfade-seam"],
  },
  typeVideo: { trackingDisplay: "-0.03em", minBodyPx: { fullscreen: 20, feed: 32 }, minHeadlinePx: { fullscreen: 60, feed: 90 }, captionHeightPct: 3.5, darkBodyWeight: 350 },
  imagery: { allow: ["grain", "product-screenshots", "duotone"], ban: ["stock-people", "glossy-isometric", "ai-render", "halftone-by-reflex"], grade: null },
  voice: { tone: [], captions: { case: "sentence", style: "plain-highlight", maxWordsPerLine: 6, maxCharsPerLine: 42 }, banned: [] },
};

export async function resolveBrand(root, { fonts = true, fontsDir, log = () => {} } = {}) {
  root = resolvePath(root);
  const provenance = {};
  const conflicts = [];
  const warnings = [];
  const rel = (p) => (p ? relative(root, p) || "." : p);
  const prov = (pointer, entry, confidence = "exact") => {
    provenance[pointer] = { source: entry.file ? rel(entry.file) : entry.source ?? "derived", selector: entry.selector ?? entry.name ?? null, raw: entry.raw ?? entry.value ?? null, confidence, ...(entry.rule ? { rule: entry.rule } : {}) };
  };

  // 1. Sources
  const designPath = findDesignMd(root);
  const design = designPath ? readDesignMd(designPath) : null;
  const { vars, files: cssFiles } = readCssVars(root);
  const tokenFiles = findTokenFiles(root);
  const dtcg = tokenFiles.map(readDtcg);
  log(`sources: design=${rel(designPath) ?? "none"} css=${cssFiles.length} dtcg=${tokenFiles.length}`);

  // Lookup chain per scope: DESIGN.md frontmatter → DESIGN.md tables → DTCG → CSS.
  const fm = design?.frontmatter ? frontmatterLookups(design.frontmatter, designPath) : { light: new Map(), dark: new Map() };
  const tableMaps = { light: new Map(), dark: new Map() };
  for (const row of design?.tables ?? []) {
    for (const scope of ["light", "dark"]) {
      const c = row[scope];
      if (c && !tableMaps[scope].has(row.name)) tableMaps[scope].set(row.name, { value: c.hex, raw: `oklch(${c.oklch.join(" ")})`, file: designPath, selector: `table:${row.name}:${scope}` });
    }
  }
  const cssMaps = { light: resolvedMap(vars, "light"), dark: resolvedMap(vars, "dark") };
  // Source-major precedence: the first source that yields a valid colour for a
  // role wins, so a DESIGN.md table beats an app's local CSS even when the CSS
  // uses an earlier candidate name.
  const chain = (scope) => [fm[scope], tableMaps[scope], ...dtcg.map((d) => d[scope]), cssMaps[scope]];
  const colorLookup = (m) => (name) => { const hit = m.get(name); return hit && normalizeColor(hit.value) ? hit : undefined; };
  const assignAcross = (scope) => {
    const merged = { assigned: {}, provenance: {}, perSource: [] };
    for (const m of chain(scope)) {
      if (!m.size) continue;
      const r = assignRoles(colorLookup(m), { names: [...m.keys()] });
      merged.perSource.push(r);
      for (const [role, c] of Object.entries(r.assigned)) if (!merged.assigned[role]) { merged.assigned[role] = c; merged.provenance[role] = r.provenance[role]; }
    }
    return merged;
  };

  // 2. Roles
  const light = assignAcross("light");
  const hasDarkScope = vars.dark.size > 0 || tableMaps.dark.size > 0 || fm.dark.size > 0 || dtcg.some((d) => d.dark.size);
  const dark = hasDarkScope ? assignAcross("dark") : { assigned: {}, provenance: {}, perSource: [] };
  // A dark scope that only overrides a few vars inherits the rest of its chain from light via resolvedMap; mark inherited ones.
  if (!light.assigned.bg || !light.assigned.fg) {
    // No light palette at all: maybe the product is dark-only and declared under :root with a dark colour-scheme.
    const probe = light.assigned.bg && light.assigned.bg.oklch[0] < 0.4;
    if (!probe && !light.assigned.bg) warnings.push("no background colour found in any source; house defaults used");
  }

  const roles = { light: {}, dark: {} };
  const required = ["bg", "surface", "fg", "muted", "border", "accent", "accent-fg", "success", "warning", "error"];
  for (const scope of ["light", "dark"]) {
    const a = scope === "light" ? light : dark;
    for (const role of required) {
      const c = a.assigned[role];
      if (!c) continue;
      roles[scope][role] = { oklch: c.oklch, hex: c.hex };
      const p = a.provenance[role];
      prov(`/color/roles/${scope}/${role}`, p, p.selector?.startsWith("table:") || p.selector?.startsWith("frontmatter") ? "exact" : "exact");
    }
  }
  // Conflicts: CSS value vs DESIGN.md value for the same role.
  for (const scope of ["light", "dark"]) {
    const a = scope === "light" ? light : dark;
    for (const role of required) {
      const kept = a.assigned[role];
      if (!kept) continue;
      for (const r of a.perSource) {
        const other = r.assigned[role];
        if (other && other.entry.file !== kept.entry.file && deltaE(kept.hex, other.hex) > 0.02) {
          conflicts.push({ pointer: `/color/roles/${scope}/${role}`, kept: kept.hex, keptFrom: `${rel(kept.entry.file)} ${a.provenance[role].name}`, other: other.hex, otherFrom: `${rel(other.entry.file)} ${r.provenance[role].name}`, deltaE: deltaE(kept.hex, other.hex) });
        }
      }
    }
  }

  // 3. Derivations and defaults
  const light0 = roles.light;
  const isDarkFirst = !light0.bg && roles.dark.bg;
  if (isDarkFirst) {
    // Everything was declared under a dark scope only: treat dark as canonical.
    roles.light = {};
  }
  const fillScope = (scope, base) => {
    const r = roles[scope];
    const isDark = scope === "dark";
    const derived = (role, value, rule) => { r[role] = { oklch: value.oklch, hex: value.hex }; prov(`/color/roles/${scope}/${role}`, { source: "derived", rule }, "inferred"); };
    if (!r.bg) {
      if (base?.bg) derived("bg", isDark ? fromOklch([0.17, Math.min(base.bg.oklch[1], 0.02), base.bg.oklch[2]]) : fromOklch([0.975, Math.min(base.bg.oklch[1], 0.01), base.bg.oklch[2]]), `${isDark ? "dark" : "light"} ground from the other mode's hue (dark-mode.md)`);
      else derived("bg", fromOklch(isDark ? [0.17, 0.008, 250] : [0.975, 0.004, 250]), "house default");
    }
    if (!r.fg) derived("fg", base?.fg && !isDark ? fromOklch([0.22, Math.min(base.fg.oklch[1], 0.01), base.fg.oklch[2]]) : fromOklch(isDark ? [0.94, 0.005, r.bg.oklch[2]] : [0.22, 0.01, r.bg.oklch[2]]), "ink from ground hue, never pure black/white");
    if (!r.surface) derived("surface", shift(r.bg.hex, { dl: isDark ? 0.035 : -0.03 }), "ground ±3-4 L (dark-mode.md elevation)");
    if (!r.muted) derived("muted", fromOklch([isDark ? 0.72 : 0.5, Math.min(r.fg.oklch[1] + 0.005, 0.03), r.fg.oklch[2]]), "fg hue at L 0.50/0.72");
    if (!r.border) derived("border", shift(r.bg.hex, { dl: isDark ? 0.12 : -0.1 }), "ground ±10-12 L");
    if (!r.accent) {
      if (base?.accent) derived("accent", isDark ? shift(base.accent.hex, { dl: 0.18, dc: -0.03 }) : shift(base.accent.hex, { dl: -0.18, dc: 0.02 }), "other mode's accent, L shifted, C reduced (dark-mode.md)");
      else { derived("accent", fromOklch([0.55, 0.12, 199]), "house default accent"); warnings.push(`${scope}: no accent found; house teal used`); }
    }
    if (!r["accent-fg"]) derived("accent-fg", normalizeColor(pickForeground(r.accent.hex, [r.bg.hex, r.fg.hex, "#fcfcfc", "#111111"])), "best contrast against accent");
    const c0 = r.accent.oklch[1];
    if (!r.success) derived("success", fromOklch([isDark ? 0.72 : 0.55, Math.max(0.09, Math.min(c0, 0.14)), 150]), "house hue 150 at brand chroma");
    if (!r.warning) derived("warning", fromOklch([isDark ? 0.82 : 0.7, Math.max(0.1, Math.min(c0, 0.15)), 80]), "house hue 80 at brand chroma");
    if (!r.error) derived("error", fromOklch([isDark ? 0.68 : 0.53, Math.max(0.12, Math.min(c0 + 0.03, 0.19)), 27]), "house hue 27 at brand chroma");
  };
  if (isDarkFirst) { fillScope("dark"); fillScope("light", roles.dark); }
  else { fillScope("light"); fillScope("dark", roles.light); }
  const mode = hasDarkScope && light0.bg ? "both" : isDarkFirst ? "dark" : hasDarkScope ? "both" : "light";

  // Slop warnings (brand truth wins; recorded for the director).
  for (const scope of ["light", "dark"]) {
    const src = scope === "light" ? light : dark;
    if (src.provenance.accent?.achromatic) warnings.push(`${scope} accent is achromatic (${roles[scope].accent.hex}): the brand names no chromatic accent`);
    const a = roles[scope].accent.oklch;
    if (a[2] >= 250 && a[2] <= 320 && a[1] > 0.08) warnings.push(`${scope} accent sits in the indigo/violet band (H ${a[2]}): slop-checklist flag, brand truth kept`);
    for (const role of ["bg", "fg"]) {
      const h = roles[scope][role].hex;
      if (h === "#000000" || h === "#ffffff") warnings.push(`${scope} ${role} is pure ${h}: video uses near-black/off-white instead`);
    }
  }

  // Contrast table
  const contrastRows = [];
  for (const scope of ["light", "dark"]) {
    const r = roles[scope];
    for (const [fg, bg] of [["fg", "bg"], ["muted", "bg"], ["fg", "surface"], ["accent-fg", "accent"], ["accent", "bg"], ["border", "bg"]]) {
      const ratio = contrast(r[fg].hex, r[bg].hex);
      contrastRows.push({ mode: scope, fg, bg, ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3 });
    }
  }

  // Video colour block
  const darkBg = roles.dark.bg;
  const nearBlack = darkBg.oklch[0] < 0.12 ? fromOklch([0.13, darkBg.oklch[1], darkBg.oklch[2]]).hex : darkBg.hex;
  const video = { canvasDefault: mode === "light" ? "light" : "dark", nearBlack, gradients: { allow: ["radial", "localized-glow"], ban: ["full-screen-linear-on-dark", "gradient-text"] }, grain: { enabled: true, opacity: 0.06 } };
  prov("/color/video/nearBlack", { source: "derived", rule: darkBg.oklch[0] < 0.12 ? "dark bg with L clamped to 0.13" : "dark bg" }, "default");

  // 4. Type
  const nextFonts = readNextFonts(findLayoutFiles(root));
  const faces = readFontFaces(cssFiles);
  const fontLookup = (name) => cssMaps.light.get(name) || dtcg.map((d) => d.fonts.get(name)).find(Boolean);
  const fr = fontRoles(fontLookup, nextFonts, faces);
  const type = {};
  const fmType = design?.frontmatter?.typography;
  const fromFm = (key) => firstRealFamily(fmType?.[key]?.fontFamily);
  const pickFont = (role, fallbacks) => {
    const fmFam = fromFm(role === "body" ? "body" : role === "mono" ? "mono" : "display");
    if (fmFam) return { family: fmFam, source: { kind: "css" }, provenance: { file: designPath, selector: `frontmatter.typography.${role}.fontFamily`, value: fmFam } };
    if (fr[role]) return fr[role];
    for (const f of fallbacks) if (fr[f]) return { ...fr[f], inherited: f };
    return null;
  };
  const picks = { display: pickFont("display", ["body"]), body: pickFont("body", ["display"]), mono: pickFont("mono", []) };
  if (!picks.display && nextFonts[0]) picks.display = { family: nextFonts[0].family, source: { kind: nextFonts[0].kind }, nextFont: nextFonts[0], provenance: { file: nextFonts[0].file, selector: "first next/font import", value: nextFonts[0].family } };
  if (!picks.body && picks.display) picks.body = { ...picks.display, inherited: "display" };
  if (!picks.display && faces.size) { const f = [...faces.values()][0]; picks.display = picks.body = { family: f.family, source: { kind: "local" }, face: f, provenance: { file: f.file, selector: "@font-face", value: f.family } }; }
  for (const role of ["display", "body", "mono"]) {
    const p = picks[role];
    if (!p) { if (role !== "mono") { type[role] = { family: role === "mono" ? "JetBrains Mono" : "Inter", source: { kind: "hyperframes-bundled" }, files: [], weights: null, fallback: "sans-serif" }; prov(`/type/${role}/family`, { source: "default", rule: "no font found; HyperFrames bundled fallback" }, "default"); warnings.push(`no ${role} font found`); } continue; }
    const nf = p.nextFont ?? nextFonts.find((f) => f.family.toLowerCase() === p.family.toLowerCase());
    const face = p.face ?? faces.get(p.family);
    const kind = face?.files?.length ? "local" : nf?.kind === "local" ? "local" : nf ? "google" : HYPERFRAMES_BUNDLED.has(p.family) ? "hyperframes-bundled" : "css";
    const stack = [...new Set([...(p.stack ?? []), p.family])].filter((f) => faces.get(f)?.files?.length || f === p.family);
    type[role] = { family: p.family, stack, source: { kind }, files: [], weights: nf?.weights ?? (face ? face.weights : null), fallback: /mono/i.test(role) ? "ui-monospace, monospace" : "system-ui, sans-serif", localSources: face?.files ?? nf?.files ?? [] };
    prov(`/type/${role}/family`, { ...(p.provenance ?? {}), file: p.provenance?.file, selector: p.provenance?.selector ?? p.provenance?.name, value: p.family }, p.inherited ? "inferred" : "exact");
    if (p.inherited) provenance[`/type/${role}/family`].rule = `inherited from ${p.inherited}`;
  }
  const scaleRatio = Number(design?.frontmatter?.typography?.scaleRatio) || 1.25;
  const typeBlock = { ...type, scale: { ratio: scaleRatio, basePx: 16 }, tracking: { display: "-0.02em", body: "0", caps: "0.08em" }, video: HOUSE.typeVideo };
  prov("/type/scale", { source: "default", rule: "web-design token-core ratio 1.25" }, "default");

  // 5. Fonts materialization
  if (fonts) {
    const dir = fontsDir ?? join(root, "compositor", "fonts");
    for (const role of ["display", "body", "mono"]) {
      const t = type[role];
      if (!t) continue;
      const same = Object.values(type).find((o) => o !== t && o.family === t.family && o.files?.length);
      if (same) { t.files = same.files; t.faceCss = same.faceCss; continue; }
      if (t.source.kind === "local" && t.localSources.length) {
        // Every local family in the stack ships (a digits subset plus the text face, say).
        const parts = (t.stack ?? [t.family]).map((fam) => { const f = faces.get(fam); return f?.files?.length ? materializeLocal(fam, f.files, dir, f.weights, f.ranges) : null; }).filter(Boolean);
        if (!parts.length) parts.push(materializeLocal(t.family, t.localSources, dir, t.weights ?? []));
        t.files = parts.flatMap((r) => r.files).map(rel); t.faceCss = parts.map((r) => r.css).join("\n");
      } else if (t.source.kind === "google" || t.source.kind === "css") {
        const r = await materializeGoogle(t.family, t.weights, dir);
        if (r.error) {
          if (/ 400$/.test(r.error) && role === "mono") { warnings.push(`font ${t.family} is not on Google Fonts; JetBrains Mono (HyperFrames bundled) stands in`); t.family = "JetBrains Mono"; t.source.kind = "hyperframes-bundled"; provenance[`/type/${role}/family`].confidence = "default"; }
          else warnings.push(`font ${t.family}: not materialized (${r.error}); render will rely on system fonts or fail font_family_without_font_face`);
          t.files = [];
        } else { t.files = r.files.map(rel); t.faceCss = r.css; if (t.source.kind === "css") t.source.kind = "google"; }
      }
      delete t.localSources;
    }
  } else for (const t of Object.values(type)) delete t.localSources;

  // 6. Spacing, radius, shadow
  const radiusVar = cssMaps.light.get("radius") || cssMaps.light.get("radius-md") || cssMaps.light.get("radius-lg");
  const radius = radiusVar ? radiusVar.value : design?.frontmatter?.rounded?.md ?? "8px";
  const radiusBlock = { values: [radius, "999px"], video: radius };
  prov("/radius/values", radiusVar ? { file: radiusVar.file, selector: radiusVar.selector, name: "radius", raw: radiusVar.raw } : { source: design?.frontmatter?.rounded ? rel(designPath) : "default", rule: "frontmatter.rounded.md or 8px" }, radiusVar ? "exact" : design?.frontmatter?.rounded ? "exact" : "default");
  const spacing = { basePx: 4, scale: [1, 2, 4, 6, 8, 12, 20] };
  const shadow = { approach: cssFiles.some((f) => { try { return /box-shadow\s*:\s*0\s+\d+px\s+\d+px/.test(readFileSync(f, "utf8")); } catch { return false; } }) ? "soft" : "edge" };
  prov("/shadow/approach", { source: "derived", rule: "box-shadow usage frequency in CSS" }, "inferred");

  // 7. Motion
  const easeVar = [...cssMaps.light.entries()].find(([k, v]) => /^ease-(out|brand|default)$/.test(k) && /cubic-bezier|linear\(/.test(v.value));
  const motion = structuredClone(HOUSE.motion);
  if (easeVar) {
    const cb = easeVar[1].value.match(/cubic-bezier\(([^)]+)\)/);
    motion.easing.brand = cb ? { gsap: "CustomEase:brand", bezier: cb[1].split(",").map(Number) } : { gsap: "CustomEase:brand", linear: easeVar[1].value };
    prov("/motion/easing/brand", { file: easeVar[1].file, selector: easeVar[1].selector, name: easeVar[0], raw: easeVar[1].raw }, "exact");
  }
  const dials = design?.prose?.dials;
  if (dials?.motion) { motion.register = dials.motion >= 7 ? "playful" : dials.motion <= 3 ? "smooth" : "ios"; prov("/motion/register", { file: designPath, selector: "Dials", raw: `motion ${dials.motion}` }, "inferred"); }
  prov("/motion/durations", { source: "derived", rule: "video scale: UI normal 200ms × 3.5 ≈ medium; motion-doctrine timing intents" }, "default");

  // 8. Identity
  const pkg = existsSync(join(root, "package.json")) ? readJson(join(root, "package.json")) : {};
  const name = design?.prose?.name || titleCase(pkg.name?.replace(/^@[^/]+\//, "").replace(/-(suite|app|web|site|blog|landing)$/, "")) || basename(root);
  prov("/identity/name", design?.prose?.name ? { file: designPath, selector: "H1 or frontmatter.name" } : { file: join(root, "package.json"), selector: "name" }, design?.prose?.name ? "exact" : "inferred");
  const logos = await classifyLogos(findLogoFiles(root));
  const logo = { mark: logos.mark ? rel(logos.mark.path) : null, wordmark: logos.wordmark ? rel(logos.wordmark.path) : null, lockup: logos.lockup ? rel(logos.lockup.path) : null, mono: Object.fromEntries(Object.entries(logos.mono).map(([k, v]) => [k, rel(v.path)])), favicon: logos.favicon ? rel(logos.favicon.path) : null, clearSpace: "1x", minSizePx: 24 };
  for (const k of ["mark", "wordmark", "lockup"]) if (logos[k]) prov(`/identity/logo/${k}`, { file: logos[k].path, selector: `aspect ${logos[k].ratio}` }, logos[k].confidence ?? "inferred");
  if (!logo.mark && !logo.wordmark) warnings.push("no logo found (public/, brand/, app/icon.*, also under apps/* and packages/*); `mark` mode can generate one");

  const brand = {
    $schema: "compositor/brand.schema.json",
    version: 1,
    identity: { name, tagline: design?.prose?.essence ?? design?.prose?.description ?? null, logo },
    color: { mode, roles, video, contrast: contrastRows },
    type: typeBlock,
    spacing,
    radius: radiusBlock,
    shadow,
    motion,
    imagery: { ...HOUSE.imagery, grade: design?.prose?.direction ?? null },
    voice: { ...HOUSE.voice, tone: design?.prose?.adjectives ?? [] },
    aesthetic: { direction: design?.prose?.direction ?? null, signature: design?.prose?.signature ?? null, essence: design?.prose?.essence ?? null, dials: dials ?? null },
    platforms: {},
    sources: { design: rel(designPath), css: cssFiles.slice(0, 12).map(rel), dtcg: tokenFiles.map(rel), layouts: findLayoutFiles(root).slice(0, 6).map(rel) },
    provenance,
    conflicts,
    warnings,
  };
  const errors = validateBrand(brand);
  return { brand, errors };
}

function titleCase(s) {
  return s ? s.split(/[-_\s]+/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ") : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const root = resolvePath(args.root ?? ".");
  const out = resolvePath(args.out ?? join(root, "compositor", "brand.json"));
  if (existsSync(out) && !args.refresh) {
    process.stderr.write(`brand.json exists at ${out}; pass --refresh to rebuild\n`);
    if (args.json) process.stdout.write(readFileSync(out, "utf8"));
    process.exit(0);
  }
  const { brand, errors } = await resolveBrand(root, { fonts: args.fonts !== false, log: (m) => process.stderr.write(m + "\n") });
  writeJson(out, brand);
  if (args.json) process.stdout.write(JSON.stringify(brand, null, 2));
  else {
    const r = brand.color.roles;
    process.stdout.write(`${brand.identity.name}: mode ${brand.color.mode}, accent ${r.light.accent.hex}/${r.dark.accent.hex}, bg ${r.light.bg.hex}/${r.dark.bg.hex}, display ${brand.type.display.family} (${brand.type.display.source.kind}, ${brand.type.display.files?.length ?? 0} files), body ${brand.type.body.family}, logo ${brand.identity.logo.mark ?? "none"}\n`);
    for (const c of brand.conflicts) process.stdout.write(`conflict ${c.pointer}: kept ${c.kept} (${c.keptFrom}) vs ${c.other} (${c.otherFrom})\n`);
    for (const w of brand.warnings) process.stdout.write(`warning: ${w}\n`);
    process.stdout.write(`→ ${out}\n`);
  }
  if (errors.length) { for (const e of errors) process.stderr.write(`schema: ${e}\n`); process.exit(2); }
}
