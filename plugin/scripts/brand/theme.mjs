#!/usr/bin/env node
// brand.json → brand.css (CSS custom properties + @font-face) for HyperFrames
// templates, and → theme.json for the Manim engine.
//   node theme.mjs --brand compositor/brand.json --out project/brand.css [--mode dark] [--manim theme.json]
import { parseArgs } from "../lib/args.mjs";
import { readJson, writeText, writeJson } from "../lib/fs.mjs";

export function brandCss(brand, { mode } = {}) {
  const canvas = mode ?? brand.color.video.canvasDefault;
  const roles = brand.color.roles[canvas] ?? brand.color.roles.light;
  const other = brand.color.roles[canvas === "dark" ? "light" : "dark"];
  const lines = [];
  for (const [role, c] of Object.entries(roles)) lines.push(`  --color-${role}: ${c.hex};`);
  for (const [role, c] of Object.entries(other)) lines.push(`  --color-${role}-alt: ${c.hex};`);
  lines.push(`  --color-near-black: ${brand.color.video.nearBlack};`);
  const fam = (t) => `"${(t.stack?.length ? t.stack : [t.family]).join('", "')}", ${t.fallback ?? "sans-serif"}`;
  lines.push(`  --font-display: ${fam(brand.type.display)};`);
  lines.push(`  --font-body: ${fam(brand.type.body)};`);
  if (brand.type.mono) lines.push(`  --font-mono: ${fam(brand.type.mono)};`);
  lines.push(`  --tracking-display: ${brand.type.video?.trackingDisplay ?? "-0.03em"};`);
  lines.push(`  --tracking-body: ${brand.type.tracking?.body ?? "0"};`);
  lines.push(`  --radius: ${brand.radius?.video ?? brand.radius?.values?.[0] ?? "8px"};`);
  lines.push(`  --radius-pill: 999px;`);
  lines.push(`  --space: ${brand.spacing?.basePx ?? 4}px;`);
  const m = brand.motion;
  for (const [k, v] of Object.entries(m.durations)) lines.push(`  --dur-${k}: ${v}s;`);
  for (const [k, v] of Object.entries(m.easing)) if (v.bezier) lines.push(`  --ease-${k}: cubic-bezier(${v.bezier.join(", ")});`);
  lines.push(`  --grain-opacity: ${brand.color.video.grain?.enabled ? brand.color.video.grain.opacity : 0};`);
  const faces = [brand.type.display, brand.type.body, brand.type.mono].filter(Boolean).map((t) => t.faceCss).filter(Boolean);
  const unique = [...new Set(faces.flatMap((f) => f.split("\n")))];
  return `/* compositor brand.css — generated from brand.json (${brand.identity.name}, ${canvas} canvas). Do not edit. */\n${unique.join("\n")}\n:root {\n${lines.join("\n")}\n}\n`;
}

// Values the Manim engine's theme.py reads (explain mode).
export function manimTheme(brand, { mode } = {}) {
  const canvas = mode ?? brand.color.video.canvasDefault;
  const r = brand.color.roles[canvas];
  const alt = brand.color.roles[canvas === "dark" ? "light" : "dark"];
  return {
    BG: canvas === "dark" ? brand.color.video.nearBlack : r.bg.hex,
    INK: r.fg.hex,
    MUTED: r.muted.hex,
    GRID: r.border.hex,
    DATA: r.accent.hex,
    MODEL: r.warning.hex,
    ERROR: r.error.hex,
    SIGNAL: r.success.hex,
    FOCUS: alt.accent.hex === r.accent.hex ? r.warning.hex : alt.accent.hex,
    FONT: brand.type.display.family,
    MONO: brand.type.mono?.family ?? "JetBrains Mono",
    fontFiles: [brand.type.display, brand.type.body, brand.type.mono].filter(Boolean).flatMap((t) => t.files ?? []),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const brand = readJson(args.brand ?? "compositor/brand.json");
  if (args.out) writeText(args.out, brandCss(brand, { mode: args.mode }));
  if (args.manim) writeJson(args.manim, manimTheme(brand, { mode: args.mode }));
  if (!args.out && !args.manim) process.stdout.write(brandCss(brand, { mode: args.mode }));
}
