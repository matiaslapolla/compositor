# mark: parametric marks, logos and icon packages

Source research: `docs/research/parametric-logos.md`. Code: `scripts/mark/`, gate: `scripts/gates/logo-gate.mjs`.

## Pipeline

1. **Spec** (`spec.json`): which generator, its params, a seed, optional boolean layers.
2. **Compose** (`compose.mjs`): `buildMark(spec, brand)` runs the generator, applies layers, centres the mark optically and resolves colours from `brand.color.roles[mode]`. `composeMark` returns only the SVG.
3. **Package** (`package.mjs`): writes the full logo package (file list below).
4. **Gate** (`gates/logo-gate.mjs`): measures the package. It never uses a browser.

```json
{
  "generator": "monogram",
  "params": { "letters": "S", "container": "squircle" },
  "seed": 1,
  "layers": [{ "generator": "boolean", "params": { "a": "circle", "b": "circle" }, "op": "difference" }],
  "optical": { "centre": true, "overshoot": 0.02, "bias": 0.02 },
  "colors": { "mode": "light" },
  "clearSpace": 1,
  "lockup": { "horizontal": { "ratio": 0.56, "gap": 0.42 }, "stacked": { "ratio": 0.3, "gap": 0.3 } }
}
```

```sh
node scripts/mark/package.mjs --spec spec.json --brand compositor/brand.json --out compositor/runs/<slug>/dist/mark \
  [--wordmark "Orbit" --font compositor/fonts/Brand-Medium.ttf] [--no-wordmark] [--no-browser] [--json]
node scripts/gates/logo-gate.mjs --dir compositor/runs/<slug>/dist/mark [--json]   # or --run <runDir>: reads plan.mark.outDir
```

Exit codes: 0 done, 1 runtime failure (for example no Chromium: add `--no-browser`), 2 usage error (bad spec, unknown generator or param, no usable font). The font must be `.ttf`, `.otf` or `.woff`. opentype.js cannot read WOFF2: decompress it first with `python -m fontTools.ttLib.woff2 decompress`. Without `--font`, the package looks for a readable file in `brand.type.display.files`.

## Generator contract

Each file in `scripts/mark/generators/` exports `{ name, description, params, generate(params, seed) }`. `GENERATORS` and `listGenerators()` come from `generators/index.mjs`. Missing params take their defaults. `generate` is a pure function of `(params, seed)`; randomness comes only from `rng(seed)`.

`generate` returns `{ elements, viewBox: "0 0 1000 1000", meta: { centroid, bbox, area, overshoot, construction } }`.

- `elements[].fill` is symbolic, so recolouring is a lookup:
  - `role:<name>` is a brand role (`role:accent`, `role:fg`, …).
  - `shade:<k>` is the accent with its OKLCH lightness multiplied by k.
  - A hex is used as given.
- `construction` is a list of `{ type: "circle", cx, cy, r }` and `{ type: "line", x1, y1, x2, y2 }`: the generating geometry for the board.

## Catalogue

| Generator | What it draws | Key params (default) | Good for |
|---|---|---|---|
| `container` | Figma smooth-corner rect (radius R, smoothing ξ) or Lamé superellipse \|x/a\|ⁿ + \|y/b\|ⁿ = 1, solid or as a ring | `shape` (smooth), `radius` (200), `smoothing` (0.6), `exponent` (5), `ring` (0) | App-icon shapes, badges, a frame for another layer |
| `grid` | Golden-rectangle subdivision as gapped quarter-disc sectors, square tiles or a φ-tapered spiral. It always returns the unit grid and golden construction. | `layer` (sectors), `depth` (5), `gap` (16), `divisions` (24) | Bauhaus-style geometric marks; the construction layer for any board |
| `monogram` | 1–3 capitals A–Z from a geometric stroke skeleton (stems, bars, diagonals, elliptic bowls). It can sit in a container, with the letters knocked out or not. | `letters` (S), `weight` (0.17 of cap height), `thinning` (0.88), `overshoot` (0.02), `tracking` (0.6), `container` (none), `knockout` (true) | Initials, app icons, product monograms |
| `boolean` | Two primitives (circle, square, triangle, ring, half-disc) on a ¼-unit grid, combined with union, difference, intersect or xor | `a` (square), `b` (circle), `op` (difference), `scaleB` (0.5), `dx`, `dy` (1, −1) | One-idea cut or bite marks; also the boolean toolkit (`union`, `difference`, `intersect`, `xor`, `strokeOutline`, `measure`) |
| `metaball` | Soft union of circles. The SDF smooth-min keeps the radii exact. The classic Σr²/d² field is also available. The outline comes from marching squares on a 256² grid, smoothed with Catmull-Rom. | `arrangement` (ring), `count` (3), `radius` (150), `spread` (190), `mode` (smin), `blend` (120) | Friendly, organic brands that still need a stated radius set |
| `phyllotaxis` | Vogel spiral θ = n·137.508°, r = c√n, dots that grow outward, clipped to a circle, squircle or square | `count` (34), `dot` (1.2), `grow` (0.4), `clip` (drop) | Hero art, patterns, large sizes only |
| `trochoid` | Rose r = cos(p/q·θ), hypotrochoid or epitrochoid over the exact period, filled even-odd or drawn as one band | `curve` (rose), `p`/`q` (3/1), `R`/`r`/`d`, `render` (fill), `weight` (72) | Propeller and petal forms, rosettes, loop animations |
| `isometric` | Cube, slab stack or extruded n-gon. Visible faces come from painter's order plus boolean difference and are split by gap channels. Fills: `role:accent` top, `shade:0.8` left, `shade:0.6` right. | `shape` (cube), `levels` (3), `sides` (6), `gap` (16) | Infra, data, storage and dev-tool brands |
| `voronoi` | A few Lloyd-relaxed Voronoi cells (d3-delaunay) clipped to a convex container, inset and corner-rounded with exact arcs | `count` (7), `relax` (6), `container` (circle), `gap` (28), `round` (22), `highlight` (0) | Mosaic, territory and community marks; calm, not a network |
| `truchet` | Seeded Smith quarter-arc bands or Truchet triangles on n×n tiles, merged into one outline and clipped | `n` (3), `tile` (arc), `weight` (0.34), `container` (circle) | Path, flow and route ideas; generative identity systems (one seed per surface) |
| `fourier` | A closed path or polyline resampled by arc length, sent through a DFT and rebuilt from the harmonics \|k\| ≤ N. The meta carries the epicycles for animation. | `d` / `points` / `shape` (triangle), `harmonics` (3), `samples` (256), `size` | Softening any polygon or traced logo into an even-curvature form; epicycle animations |

### Routing: when a brief says X, use Y

- "Our initials", "an app icon with our letter": `monogram`, with `container: "squircle"` for an app icon.
- "App icon shape", "badge", "rounded square like iOS": `container` (smooth, ξ 0.6). It can also be a layer under another mark.
- "Simple, geometric, Swiss, one shape": `boolean` (a bite or cut), or `grid` sectors.
- "Golden ratio", "show the construction": `grid`. Every package also ships `mark-construction.svg`.
- "Friendly", "soft", "blobby but clean": `metaball` (ring of 3, smin).
- "Growth", "nature", "seeds": `phyllotaxis` for hero art. Pair it with `monogram` or `container` for the favicon.
- "Motion", "loop", "petal", "propeller": `trochoid` (rose 3/1 filled, or a band).
- "Infrastructure", "blocks", "stack", "data": `isometric` (cube or stack).
- "Community", "territory", "mosaic", "cells": `voronoi`.
- "Paths", "routes", "flow", "generative system": `truchet`.
- "Smooth this shape", "make our polygon friendlier", "epicycles": `fourier`.

## Craft rules the module enforces

1. **Optical centre.**
   - `buildMark` moves the area centroid of all paint to (500, 500 − bias·h), with bias 0.02 of the mark height.
   - If the paint would leave the canvas, the mark shrinks about that point.
   - The gate reports the centroid offset from the bbox centre and warns above 4%.
2. **Overshoot.** Monogram rounds (O, C, G, Q, S, U, J) pass the cap height and the baseline by `overshoot × cap height` (2% by default; `optical.overshoot` sets it for every generator that has the param).
3. **One weight, thinned horizontals.**
   - Monogram strokes use `w(t) = wₕ + (w − wₕ)·|t_y|`, with wₕ = 0.88·w.
   - Diagonals are parallelograms with horizontal cuts, so apexes and vertices sit on the cap height and the baseline.
   - Terminals (C, G, S) are cut vertically.
4. **Small radius set, flat paint.**
   - Containers, Voronoi cells, Truchet bands and grid sectors use exact arcs.
   - `mark.svg` contains `<svg>` and `<path>` only: no gradient, filter, mask, image or text.
5. **Mono survives.** Multi-tone marks (`isometric`, `voronoi` highlight) separate their regions with gap channels, so `mark-mono-*.svg` still reads in one colour.
6. **Minimum sizes.**
   - At 16 px the stroke must stay at least 1 px.
   - At 32 px the counters must stay at least 2 px wide.
   - The defaults of every generator except `phyllotaxis` pass both checks.
7. **Lockups.**
   - Horizontal: the wordmark cap height is 0.56 × the mark height, the middle of the cap height sits on the mark's optical centre, and the gap is 0.42 × the mark height.
   - Stacked: the cap height is 0.3 × the mark height (the wordmark is at most 1.8 × the mark width) and the gap is 0.3 × the mark height.
   - The wordmark is outlined with opentype.js. No `<text>` reaches an asset.
8. **Clear space.** The brand sheet draws it at `spec.clearSpace` × the mark height (1.0 by default). Lockup files carry 0.25 × the mark height of padding.
9. **Platform safe zones.**
   - `icon-maskable-512.png`: every point of the mark is within 38% of the size from the centre (the limit is 40%).
   - `apple-touch-icon` and `icon-192`/`icon-512`: the mark fills 80% on an opaque brand background.
   - `avatar-400`: the mark fills 60%.
   - Icons scale about the canvas centre, so the optical centring is kept.

## Package

```
logo/     mark.svg  mark-mono-black.svg  mark-mono-white.svg  mark-construction.svg
          wordmark.svg  lockup-horizontal.svg  lockup-stacked.svg
raster/   mark-{16,32,64,128,256,512,1024}.png  mark-{256,512,1024}.webp (lossless, transparent, sRGB from sharp)
web/      favicon.ico (ICONDIR packed by hand with PNG entries 16/32/48)  favicon.svg (mono, prefers-color-scheme)
          apple-touch-icon.png (180, opaque)  icon-192.png  icon-512.png  icon-maskable-512.png  manifest.webmanifest
social/   avatar-400.png  og-1200x630.png (Chromium)
brand-sheet.png (1600×2000, Chromium)
manifest.json  (every file with its size; skipped files and why; the mark's centroid, bbox and fills)
```

`--no-browser` skips the OG card and the brand sheet and records them in `manifest.json` → `skipped`. Without a font, the wordmark and the lockups are skipped too.

The brand sheet (`sheet.mjs`, importable: `sheetHtml`, `ogHtml`, `renderHtml`) shows:

- the lockup
- the mark on its construction grid
- the clear-space diagram
- a minimum-size strip at real pixels (16/24/32/48), light and reverse
- colour chips with hex and OKLCH
- colour, one-colour and reverse tiles
- three "don't" examples: stretched, low contrast, effects

## Gate rules (`logo-gate.mjs`)

| Rule | Measure | Fails when |
|---|---|---|
| `logo.files` | Every package file is present and not empty | A file is missing. A skipped browser file is a warn. |
| `logo.stroke-16` | `mark.svg` is rendered at 16 px with 3× supersampling (alpha > 0.5). For each connected component: the share of ink kept by a 3×3 opening, and the share that survives a 3×3 erosion. | A component keeps < 85% under the opening, or nothing survives the erosion |
| `logo.counter-32` | Enclosed background regions at 32 px, matched to the counters at 256 px | A real counter closes up or is < 2 px across. Sub-pixel channels are ignored. |
| `logo.no-gradients` | Scans `mark.svg` for `<linearGradient\|radialGradient\|filter\|mask\|image\|text` | Any of them is present |
| `logo.mono-single-fill` | Distinct paints in the two mono files | More or fewer than one |
| `logo.maskable-safe` | The farthest non-background pixel of `icon-maskable-512.png` from the centre | It is beyond 40% of 512 (+1 px) |
| `logo.centroid` | Alpha-weighted centroid against the ink bbox centre, at 512 px | Warns above 4% |
| `logo.ssim-16` | SSIM (7×7 windows) between `mark-16.png` and `mark-1024.png` downsampled to 16 px | Warns below 0.6 |

`run(ctx)` follows the shared gate interface (`scripts/gates/common.mjs`):

- Pass findings are folded away.
- Fix hints come from `references/gates.md` (section `logo-gate`).
- The measured numbers (stroke retention, counters, maskable radius, centroid offset, SSIM) are always in `metrics`.

The functions it exports are `rasterize`, `alphaMask`, `erode`, `dilate`, `components`, `strokeSurvival`, `counterCheck`, `forbiddenTags`, `paints`, `maskableSafe`, `centroidOffset`, `luma`, `ssim`, `ssimSmall`, `checkPackage` and `run`.

**Why 3× supersampling for stroke-16.** A 3×3 erosion on the 16 px raster itself removes everything thinner than 3 px. That would fail any line mark. At 3× the erosion removes one 16 px pixel across, which is the stated "≥ 1 px" rule. The opening keeps the parts that pass the rule whole, so a well-built but intricate mark is not punished for having a long outline.

## Limits and what was left out

- **phyllotaxis** fails `logo.stroke-16` at every count that still reads as phyllotaxis: the dots merge into blobs with thin necks. Use it for hero art and patterns, and pair it with a glyph for icons.
- **trochoid** bands thinner than about 60 units, and hypo/epitrochoids with many loops, fail at 16 px. The default (rose 3/1, filled) passes.
- Deferred, as the research suggests: Lissajous, log spiral, girih/Islamic star, Penrose, circle packing.
- Lowercase letters are not in the monogram skeleton set. Wordmarks come from a real font through opentype.js.
- The smooth corner follows Figma's published construction. The iOS mask radius (22.37%) is a community estimate, not a published standard.
