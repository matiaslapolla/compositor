---
name: mark
description: Math-based marks, logos, icon sets and parametric design assets from brand tokens - superellipse containers, golden grids, monograms, metaballs, phyllotaxis, trochoids, isometric, Voronoi, Truchet, Fourier - delivered as a full logo package (SVG master, mono, construction, lockups, rasters, favicon.ico, maskable, avatar, OG, brand sheet) with a legibility gate. Use for "logo", "marca", "ícono", "favicon", "app icon", "patrón", "forma paramétrica", "golden ratio mark", "brand sheet".
argument-hint: "<concept or generator> [--wordmark Name] [--font file.ttf] [--seed n]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# mark

Catalogue, params and craft rules: `${CLAUDE_PLUGIN_ROOT}/references/mark.md`. Run contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md` (plan → package → gate → report; there is no HyperFrames build in this mode).

## Plan

1. Slug `compositor/runs/<date>-mark-<concept>`; init the trace.
2. From the brief and `brand.json` (`aesthetic`, `voice.tone`, accent hue), pick one idea and one generator family using the routing table in `mark.md` ("when a brief says X use Y"). One idea per mark: a monogram with a counter, a container with one cut, a trochoid petal. Never three ideas. Write `spec.json` (generator, params, seed, optional boolean layers, `colors.mode`). Write `plan.md` with the idea in one sentence and the construction logic.
3. If the brand has no readable font file for the wordmark (`brand.type.display.files` are woff2), ask for a `.ttf/.otf` or pass `--no-wordmark`; say that woff2 can be decompressed with `python -m fontTools.ttLib.woff2 decompress`.
4. Confirm once (AskUserQuestion: this idea / an alternative generator / change the letters) unless `--yes`. Offer at most two alternatives, each one sentence.

## Package and gate

```
node P/scripts/mark/package.mjs --spec R/spec.json --brand compositor/brand.json --out R/dist/mark [--wordmark "Name" --font f.ttf | --no-wordmark] [--json]
node P/scripts/gates/logo-gate.mjs --dir R/dist/mark
```
Read `R/dist/mark/brand-sheet.png` as an image. Judge: one idea, consistent stroke, arcs from a small radius set, survives at 16 px (the gate measures it), mono reads without colour. Up to three rounds of spec changes (stroke weight, smoothing, seed), then stop. Record `plan.mark = { spec: "spec.json", outDir: "dist/mark" }` in `plan.json` and the gate result in the trace.

## Report

The package file list (from `manifest.json`), the gate metrics (stroke retention at 16 px, counters at 32 px, SSIM, centroid offset), the sheet path, and the one change that would raise the mark most. Never call it finished if `logo.stroke-16` failed.
