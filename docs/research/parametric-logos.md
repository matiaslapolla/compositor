# Math-based shapes for logos: reference (2026-10-08)

## Environment (verified)
`sharp` 0.35.5 (libvips 8.18.7, librsvg 2.63.2, cairo, pango, fontconfig) and `puppeteer-core` 25.12.0 inside the global hyperframes `node_modules`. sharp rasterized a test SVG to 512px with exact sRGB hex round-trip, 4 channels. `sharp.format` has no `.ico`: pack it by hand. Not present: resvg-js, svgo, d3, opentype.js, paper, polygon-clipping; Python has no shapely.

## Parametric vocabulary (M mark, P pattern, G grid)
All generators: pure `(params, seed) → SVG string`, `viewBox 0 0 1000 1000`, 256–720 samples, 3-decimal rounding.

| # | Shape | Formula / construction | Type |
|---|---|---|---|
| 1 | Superellipse (Lamé) | `x = a·sgn(cos t)·|cos t|^(2/n)`, `y = b·sgn(sin t)·|sin t|^(2/n)`; n=4 squircle, n≈5 iOS approximation. Real iOS corner = continuous-curvature rounded rect (arc + two cubic ramps, Figma smoothing ξ=0.6, handles 2/3–1/3). Implement both: Lamé for marks, smooth corner (ξ, R) for containers. iOS mask radius ≈ 22.37% of width (community estimate). | M/G |
| 2 | Golden grid / spiral | φ≈1.618; recursive `w × w/φ` split, quarter arcs per square; golden angle 137.508°. Lockup ratio mark:wordmark 1:φ. | G/M |
| 3 | Phyllotaxis (Vogel) | `θ_n = n·137.508°`, `r_n = c·√n`, dot r ∝ c/2. | M/P |
| 4 | Lissajous | `x = A sin(a t + δ)`, `y = B sin(b t)`; a:b ∈ {1:2, 2:3, 3:4}, δ ∈ {0, π/4, π/2}. | M |
| 5 | Rose (rhodonea) | `r = cos(kθ)`, k=p/q; sample θ∈[0, 2πq]. | M |
| 6 | Hypotrochoid / epitrochoid | `x=(R−r)cos t + d cos((R−r)/r·t)`, `y=(R−r)sin t − d sin((R−r)/r·t)`; period `2π·r/gcd(R,r)`. | M/P |
| 7 | Fourier epicycles | DFT of a sampled closed path, truncate to N harmonics → smoothed curve; animatable as nested circles. | M |
| 8 | Log spiral | `r = a·e^(bθ)`, golden b = ln(φ)/(π/2) ≈ 0.3063. | M |
| 9 | Voronoi / Delaunay | `d3-delaunay`; Lloyd relaxation 3–8 iterations; clip to container. | P/M |
| 10 | Truchet tiles | n×n grid, Smith quarter-arc tiles, seeded PRNG (mulberry32). | P |
| 11 | Islamic star / girih | Polygons-in-contact, Hankin's method, contact angles 72/54/36°; 8-fold = two squares at 45°, {8/3} stars. | P/M |
| 12 | Penrose P3 | Rhomb deflation 3–5 generations. | P |
| 13 | Metaballs | `F(p)=Σ r_i²/|p−c_i|²`, marching squares on 256² grid, isocontour F=1; smooth-union `smin(a,b,k)`. | M |
| 14 | Circle packing | Rejection sampling with `r = min(dist − r_j, boundary)`, seeded; pack inside letter silhouette. | M/P |
| 15 | Bézier monogram | Stroke skeleton → offset by width w; overshoot 1.5–3% of cap height where round meets flat; horizontals 85–90% of verticals; thin acute joins. | M |
| 16 | Isometric | `x' = (x−y)cos30°`, `y' = (x+y)sin30° − z`; or 2:1 pixel iso (26.565°); 3 fixed luminance steps. | M |
| 17 | Construction grid overlay | u = height/16 or /24; bounding square, crosshairs, circles r=k·u, 30/45/60° guides, generating circles at 40% opacity, one accent. Separate `grid.svg` layer. | G |

## Craft rules the generator enforces
1. Optical centre: centre by area centroid, bias 1–3% toward visual top.
2. Overshoot: rounds 1.5–3% beyond flat alignments, never zero when round meets flat.
3. Minimum stroke/counter: at 16px, stroke ≥ 1 device px → ≥ 62.5 viewBox units; counter ≥ 2px → ≥ 125 units. Check by rasterizing at 16/32 and thresholding connected components. Brands switch to glyph below 20–40px lockup.
4. Clear space: parameter, default 1.0 × mark height; drawn on the board.
5. Variants: full colour, one-colour black, reversed white, knockout-safe (widened negative space). Mono works without gradients/opacity.
6. Lockups: horizontal (wordmark baseline aligned to mark optical centre, gap 0.5–1 u, wordmark cap height 50–65% of mark) and stacked (gap 0.5 u).
7. Negative space: one counter-form idea max; survives at 32px.
8. Scalability: SSIM at 16/32/64/512 vs downsampled 1024 master.
9. Construction board: mark on grid with generating circles, angle labels, unit dims, clear-space box, min-size row at real pixels, colour/mono/reverse row.
10. Platform presets: `apple-icon` (1024², opaque, no baked corners, key content off edges; layered for Icon Composer, text outlined); `material-24` (24dp canvas, 20dp live area, 2dp padding, 2dp stroke, 2dp radius, keyline shapes).

## Node tooling
- Geometry → SVG: hand-rolled string builder (zero deps).
- Delaunay/Voronoi: `d3-delaunay`.
- Boolean ops: `polyclip-ts` on flattened polygons (0.25-unit tolerance). `paper-jsdom` only if curves must survive editing.
- Text → outlines: `opentype.js` (`font.getPath(text,x,y,size).toPathData(2)`), mandatory for wordmarks.
- Cleanup: `svgo` optional (keep viewBox, floatPrecision 3).
- SVG → PNG/WebP: `sharp` (installed, exact sRGB). Outline text first; no filters, no mix-blend-mode. ICO: hand-pack ICONDIR + PNG entries at 16/32/48.
- Fallback: `@resvg/resvg-js` only if a pixel-diff corpus shows librsvg artefacts. Chromium only for the HTML brand sheet and OG image (colour management can shift icons).

## Logo package
```
brand/<slug>/
  logo/ mark.svg mark-mono-black.svg mark-mono-white.svg mark-construction.svg wordmark.svg lockup-horizontal.svg lockup-stacked.svg
  raster/ mark-{16,32,64,128,256,512,1024}.png mark-{256,512,1024}.webp
  web/ favicon.ico favicon.svg (prefers-color-scheme) apple-touch-icon.png (180, opaque, mark ~80%) icon-192.png icon-512.png icon-maskable-512.png (content inside r=40% circle) manifest.webmanifest
  social/ avatar-400.png (mark ≈ 60%, circle-crop safe) og-1200x630.png (lockup left, ≥60px margins)
  brand-sheet.png (1600×2000: lockup, grid, clear space, min sizes, chips hex+OKLCH, mono/reverse, 3 don'ts)
```
Colour: author sRGB hex, no ICC on PNG; P3 only when the brand defines P3 primaries and the target is Apple marketing/Icon Composer.

## What reads "expensive" / slop tells
Expensive: one idea fully reduced (Vercel triangle), arcs from a small radius set, one angle family, one stroke weight, black/white first with one accent, mark and type share stroke/radius/cap height, scales to 16px or declares a glyph fallback.
Slop: sparkles/starbursts/glow, violet or cyan-on-dark gradient default, three ideas in one mark, nodes-and-lines brains, melted lettering, shapes off-grid or not closed, shadows/bevels in the master.

## Gate checks per export
stroke ≥ 1px at 16px; counters ≥ 2px at 32px; centroid-vs-bbox offset reported; overshoot applied where round meets flat; mono variant single fill; maskable content inside r=40%; no gradients/filters in `mark.svg`; SSIM(16px vs master) above threshold.

## First generators (ordered)
1 smooth-corner container + Lamé; 2 unit/golden grid + construction overlay; 3 Bézier monogram kit + opentype wordmark freezing; 4 boolean toolkit; 5 metaballs; 6 phyllotaxis; 7 hypotrochoid/rose; 8 isometric primitives; 9 Voronoi + Truchet; 10 Fourier smoother. Defer Penrose/girih, circle packing, Lissajous.

Sources: Figma "Desperately seeking squircles", squircle.js, Apple HIG app icons, Material system icons, Frontend Masters favicon 2024, web.dev maskable, Pentagram MIT Media Lab, Koto Amazon 2025, Basement Next.js/Vercel, 925 Studios + impeccable.style/slop. Overshoot % is a working default, not a published standard.
