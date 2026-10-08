# Brand tokens and motion identity (2026-10-08)

## Local formats
- **DESIGN.md** (`web-design/references/design-md.md`): `# DESIGN.md - <project>`; sections Context, Aesthetic (direction, signature move), Typography (display/body/mono + source + scale ratio/base/steps + tracking), Color (strategy, 60-30-10, palette role → oklch | hex, dark overrides), Spacing/radius/shadow, Layout, Components, Motion (durations, easings, transform/opacity only, reduced motion), Iconography, Imagery, Dark mode, Accessibility, **Tokens** as a `:root {}` CSS block + `Adapter:` line, Slop audit, Changelog. DESIGN.md wins over CSS drift. Observed variants: one repo uses YAML frontmatter (`colors:`, `typography:` maps, the `@google/design.md` shape); others use prose + tables with OKLCH, or plain prose.
- **Token roles** (`token-core.css`): `--color-bg, --color-surface (required), --color-fg, --color-muted, --color-border, --color-accent, --color-accent-fg, success/warning/error`; `--font-display/body/mono`; `--text-xs..3xl` ratio ~1.25; `--space-1..8` on 4px; max two radii (`--radius`, `--radius-pill`), ceiling 16px; one shadow approach; motion `--duration-instant 100 / fast 150 / normal 200 / slow 300 / sheet 500ms`, `--ease-out (0.23,1,0.32,1)`, `--ease-in-out (0.77,0,0.175,1)`, `--ease-sheet (0.32,0.72,0,1)`, `--ease-exit (0.4,0,1,1)`. Dark: base L≈0.16–0.18 never #000, fg never #FFF, +3–4 L per elevation, accent = lighter desaturated sibling.
- **Adapters**: plain CSS vars; Tailwind v4 `@theme`; shadcn `--background/--foreground/--primary…` + `.dark` + `@theme inline`.
- **Prohibited directions** (hard bans): borrowed document; showreel (neon on near-black, magnetic buttons, sticky stacks, word-by-word reveals, looping pulses); Swiss poster (giant numerals as ornament, plate numbers, paper/ink/signal-red); fake control room (status strips, hazard colours, mono prose, fake live data).
- **Slop checklist**: no indigo/violet accent, no gradient text, no glowing coloured shadows, no radial haze; not Inter/Roboto/Arial/system/Space Grotesk/Geist/Instrument Serif by reflex; display tracking ≥ −0.02em; no bounce/elastic; transform/opacity only; no identical fade-in-up ×4; never #000/#FFF.
- **HyperFrames**: house ease `power3.out` 0.6 s; `power4/expo.out` punch; `sine.inOut` ambient; `expo.inOut` scene transitions; baked `springEase({response, dampingFraction})` ζ 1.0 house / 0.80–0.85 iOS / 0.6–0.7 playful, response 0.35–0.50 entrance, 0.50–0.70 hero; stagger `each 0.08`. `hyperframes-creative/references/design-spec.md` already defines precedence `frame.md → design.md → DESIGN.md` (frontmatter normative). Video type sizes: body ≥20 px / headlines ≥60 px full-screen, body ≥32 / headlines ≥90 in-feed; tracking −0.03 to −0.05em at display; weight 350 light-on-dark body. **No full-screen linear gradients on dark (H.264 bands)**; accent at 15–25% atmospheric; web→video scale: headlines 64–120, body 28–42, labels 18–24, borders 2–4 px. 18 bundled fonts; others fetched at build (fail-closed on cloud); local fonts auto-captured on local renders.
- motion-doctrine timing: entry ≤ ~800 ms; exit ≈ 75% of entry; stagger ≤ 500 ms total; forbidden bounce/elastic; `back.out(1.4–1.7)` ok; stillness before climax 0.3–0.75 s; one current (LEFT); 2–3 transitions per film.

## Web findings
- **DTCG 2025.10** (first stable, Final CG Report 2025-10-28): token `{ $value, $type, $description, $extensions, $deprecated }`, groups with `$extends`, aliases `{group.token}` and `$ref`. Types: color (`{colorSpace, components, alpha, hex}`, spaces incl. oklch/display-p3), dimension `{value, unit}`, fontFamily, fontWeight, duration, cubicBezier, number, strokeStyle, border, transition, shadow, gradient, typography. Tools: Style Dictionary v4/v5 (2025.10 WIP), **Terrazzo** `@terrazzo/parser` (pure JS). OKLCH → sRGB hex via `culori` (`clampChroma`/`toGamut('rgb')` + `formatHex`).
- **Tailwind v4 `@theme`** namespaces: `--color-*, --font-*, --text-*, --font-weight-*, --tracking-*, --leading-*, --spacing(-*), --radius-*, --shadow-*, --ease-*, --animate-*`; `@theme inline`; emitted as `:root` vars. **shadcn**: `--background/--foreground/--card/--popover/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring/--chart-1..5/--sidebar-*`, `--radius`, `.dark`. **Figma Variables** REST (Enterprise-only) `valuesByMode`, colours as rgba floats, aliases unresolved; native DTCG export rolling out. **next/font**: `Family_Name({subsets, weight, variable:'--font-x'})`, `localFont({src})`, wired via `@theme inline { --font-sans: var(--font-inter) }`.
- **Motion identity**: Apple HIG motion (purposeful, optional, realistic, brief); SwiftUI `.default = spring(response 0.55, damping 1.0)`, `.smooth/.snappy/.bouncy`; Apple films: camera rarely still, slow subtle moves. Material 3 durations short 50–200 / medium 250–400 / long 450–600 / extraLong 700–1000 ms; easings standard `(0.2,0,0,1)`, emphasizedDecelerate `(0.05,0.7,0.1,1)`, emphasizedAccelerate `(0.3,0,0.8,0.15)`. UI → video: UI ms are invisible at video pacing; the local corpus (HF 0.6 s default, entries ≤ 800 ms, hero 0.74–1.03 s) is ~2–4× UI `normal` 200 ms. GSAP `power2.out ≈ (0.215,0.61,0.355,1)`, `expo.out ≈ (0.19,1,0.22,1)`; brand curves via `CustomEase.create("brand-out","0.23,1,0.32,1")`; all GSAP plugins free since 3.13. fps 30 social, 60 UI demos, 24 film.
- **Type in video**: 9:16 captions 3–4% of frame height (60–75 px @1920), floor 2.5%, cap 5%. Headless Chromium: ship local woff2 + `@font-face` (`font-display: block`); Google CSS splits by unicode-range.
- **Colour in video**: sRGB and Rec.709 share primaries, differ in transfer; tag `-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv`; Chrome screenshots are sRGB so P3 squeezes; OKLCH must be gamut-mapped to sRGB hex. Banding on dark gradients: grain late, `gradfun`/`deband`, lower CRF or `-tune grain`; near-black `#0a0a0a–#121212`.

## brand.json (semantic layer; every colour keeps oklch + hex; provenance per JSON pointer)
```json
{
  "$schema": "compositor/brand.schema.json", "version": 1,
  "identity": { "name": "Acme", "tagline": "…", "logo": { "mark": "public/logo-mark.svg", "wordmark": "…", "lockup": "…", "mono": { "light": "…", "dark": "…" }, "clearSpace": "1x", "minSizePx": 24 } },
  "color": {
    "mode": "both",
    "roles": { "light": { "bg": { "oklch": [0.97,0.008,95], "hex": "#f7f5f2" }, "surface": {}, "fg": {}, "muted": {}, "border": {}, "accent": {}, "accent-fg": {}, "success": {}, "warning": {}, "error": {} }, "dark": {} },
    "video": { "canvasDefault": "dark", "nearBlack": "#0b0c10", "gradients": { "allow": ["radial","localized-glow"], "ban": ["full-screen-linear-on-dark","gradient-text"] }, "grain": { "enabled": true, "opacity": 0.06 } },
    "contrast": [ { "fg": "fg", "bg": "bg", "mode": "light", "ratio": 14.2, "aa": true } ]
  },
  "type": {
    "display": { "family": "Fraunces", "source": { "kind": "google|local|hyperframes-bundled", "url": "…" }, "files": ["assets/fonts/….woff2"], "weights": [400,600,700], "variable": true, "fallback": "Georgia, serif" },
    "body": {}, "mono": {},
    "scale": { "ratio": 1.25, "basePx": 16 }, "tracking": { "display": "-0.02em", "body": "0", "caps": "0.08em" },
    "video": { "trackingDisplay": "-0.04em", "minBodyPx": { "fullscreen": 20, "feed": 32 }, "minHeadlinePx": { "fullscreen": 60, "feed": 90 }, "captionHeightPct": 3.5, "darkBodyWeight": 350 }
  },
  "spacing": { "basePx": 4, "scale": [1,2,4,6,8,12,20] },
  "radius": { "values": ["2px","999px"], "video": "4px" },
  "shadow": { "approach": "edge|soft|hard-offset|none" },
  "motion": {
    "fps": 30, "direction": "left", "register": "smooth|ios|playful",
    "durations": { "micro": 0.25, "short": 0.45, "medium": 0.7, "long": 1.1, "hold": 0.5 },
    "easing": { "enter": { "gsap": "power3.out", "bezier": [0.23,1,0.32,1] }, "exit": { "gsap": "power3.in" }, "move": { "gsap": "power2.inOut" }, "scene": { "gsap": "expo.inOut" }, "ambient": { "gsap": "sine.inOut" }, "brand": { "gsap": "CustomEase:brand-out", "bezier": [0.23,1,0.32,1] } },
    "stagger": { "each": 0.08, "maxTotal": 0.5 }, "exitRatio": 0.75,
    "forbidden": ["bounce.out","elastic.out","idle-wobble","crossfade-seam"]
  },
  "imagery": { "allow": ["grain","duotone","product-screenshots"], "ban": ["halftone","stock-people","glossy-isometric","ai-render"], "grade": "warm, lifted blacks" },
  "voice": { "tone": ["plain","confident","technical"], "captions": { "case": "sentence", "style": "plain-highlight", "maxWordsPerLine": 6 }, "banned": ["em dashes","supercharge","world-class"] },
  "platforms": { "reels": { "canvas": "dark", "captionHeightPct": 4 } },
  "provenance": { "/color/roles/light/accent": { "source": "app/globals.css", "selector": "@theme", "property": "--color-accent", "raw": "oklch(0.53 0.15 30)", "confidence": "exact|inferred|default|user" } },
  "conflicts": [], "warnings": []
}
```
Required: `identity.name`, one logo file, `color.roles.<mode>.{bg,fg,accent}`, `type.display.family` (or body), one font source renderable in headless Chromium. Everything else inferable with defaults, recorded in provenance with `inferred|default`.

## Detection and resolution (first exact hit per field wins; later sources fill gaps)
1. Existing `brand.json` (only re-run with `--refresh`).
2. `frame.md → design.md → DESIGN.md` (root, `docs/`): frontmatter/`## Tokens` normative; prose feeds voice/imagery/aesthetic.
3. DTCG files `tokens.json`, `design-tokens.json`, `tokens/**/*.json`, `**/*.tokens.json`; role heuristics (`background|bg`, `foreground|fg|text`, `primary|accent|brand`, `muted|secondary`, `border|outline`, `success|positive`, `warning`, `error|danger|destructive`).
4. Tailwind v4 `@theme` in `app/globals.css`, `src/app/globals.css`, `src/styles/*.css`, `styles/*.css`; resolve `var()` chains and `@theme inline`.
5. shadcn `:root`/`.dark` vars (map `--background→bg`, `--card→surface`, `--foreground→fg`, `--muted-foreground→muted`, `--border`, `--primary→accent`, `--primary-foreground→accent-fg`, `--destructive→error`, `--radius`).
6. Tailwind v3 `tailwind.config.*` (evaluate, never regex alone).
7. Fonts: `app/layout.tsx`, `src/app/layout.tsx`, `app/fonts.ts` (`next/font/google|local`), `@font-face` blocks, `<link fonts.googleapis>`; roles from usage (`--font-sans`/body → body, h1 → display, `--font-mono`). Materialize every family to `assets/fonts/*.woff2`.
8. Logos: `public/logo*.{svg,png}`, `public/brand/**`, `brand/**`, `assets/brand/**`, `public/favicon*`, `app/icon.*`, `app/apple-icon.*`, `public/og*.png`; classify by aspect (≈1:1 mark, >2.5:1 wordmark) and fill (#fff/#000-only = mono). Favicon last resort, `low`.
9. Figma (only with `FIGMA_TOKEN` + file key).
10. Rendered fallback: capture the running site and sample computed styles of body/h1/a/button (`inferred`).
11. House defaults (`token-core.css`, HF `power3.out`, current LEFT, base-preset platforms) flagged `default`.

Conflicts: same role in two sources agreeing within ΔE(OK) < 0.02 merge silently; else higher precedence wins and `conflicts[]` logs it. Dark palette absent everywhere: derive and flag. Font named with no file, no Google match, not bundled: hard error. Accent in H 250–320 or #000/#FFF roles: `warnings[]` citing slop-checklist, brand truth wins.
Ask the user only when: no logo or ambiguous candidates; accent disagreement ΔE > 0.05 with no DESIGN.md; >2 font families with unassignable roles; `color.mode` undeterminable and canvas matters; `identity.name` absent from package.json/layout metadata/spec.

Note: the inventory agent found `hyperframes-localize-fonts` as a second bin in the package (`bin/hyperframes-localize-fonts.mjs`); it is not a CLI subcommand, which is why `--help` does not list it.
