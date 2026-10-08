# Template contract

A template is `templates/<mode>/<name>/` with `template.html` and `template.json`. `scripts/render/build.mjs` turns it into one standalone HyperFrames project per target: `compositor/runs/<slug>/project/<target>/index.html` (+ `hyperframes.json`, `gsap.min.js`, `fonts/`, `assets/`). Example: `templates/social/claim/`.

## template.json
```json
{ "name": "social/claim", "description": "…", "mode": "social", "kind": "both|still|motion|page", "duration": 6, "fps": 30, "loop": "seamless|hold|none",
  "targets": ["ig-square", "reels"], "canvas": "dark|light (optional, default brand.color.video.canvasDefault)",
  "instances": "slides (optional: one composition per params.slides[] item, named <target>-01…)",
  "params": { "headline": { "type": "string", "required": true, "maxWords": 7, "doc": "…" }, "accent": { "enum": ["rule","block","none"], "default": "rule" } } }
```
Optional `"html": "../other/template.html"` reuses a sibling template's composition (promo/vertical shares promo/landscape). A template that stamps seams from data passes `params.ledger` (`{ fps, seams }`, motion-doctrine schema); build.mjs writes it as `project/<target>/ledger.json` and `gates/seams.mjs` verifies it. `kind: both` renders stills for still targets and motion for motion targets. `kind: page` is a still that deliver.mjs also binds into a PDF per target (carousels). `build.mjs` validates `params` (required, maxWords, maxChars, enum, number).

## template.html
Standalone HyperFrames composition (`hyperframes-core` contract): `<div id="root" data-composition-id="main" data-start="0" data-width data-height data-duration>` directly in `<body>`, `<script src="gsap.min.js">`, one `gsap.timeline({ paused: true })` registered at `window.__timelines["main"]` at the end of the build. build.mjs rewrites the root's `data-width/height/duration/fps` per target and sets `<html data-target="…" data-kind="still|motion">`.

Placeholders: `{{param}}` (HTML-escaped), `{{{param}}}` (raw), `{{param|default}}`, `{{#param}}…{{/param}}` (when truthy), `{{^param}}…{{/param}}` (when falsy), dotted paths. Available data: every param, `copy.*` (same as params), `brand.name`, `brand.tagline`, `logo.mark` / `logo.wordmark` / `logo.lockup` (paths under `assets/`), `logo.markSvg` (inline SVG string, raw), `target.name/width/height/kind/safe`, `canvas`, `still`, `motion`, `duration`, `fps`, `json` (all params as a JSON string, for `<script type="application/json">`), and with `instances`: `slide.index`, `slide.count` plus the slide's own fields.

Injected into `<head>`: `<style id="compositor-brand">` with brand.css (`--color-bg/surface/fg/muted/border/accent/accent-fg/success/warning/error`, the `-alt` set for the other mode, `--color-near-black`, `--font-display/body/mono`, `--tracking-display/body`, `--radius`, `--radius-pill`, `--space`, `--dur-micro/short/medium/long/hold`, `--ease-enter/exit/move/scene/ambient[/brand]`, `--grain-opacity`, the `@font-face` rules for `fonts/*.woff2`) and per-target `--w`, `--h`, `--safe-top/right/bottom/left`, `--safe-w/h`, `--aspect`, `--orientation`, `--fps`, `--duration`, and a `.safe { position:absolute; inset: var(--safe-…) }` helper.

## Rules every template follows
- Colours only through `--color-*` variables (the palette gate samples pixels; `color-mix()` with transparent is fine, full-screen linear gradients on dark are not).
- Type only through `--font-display/body/mono`; sizes relative to `--w`/`--h` (`min(calc(var(--w)*0.1), calc(var(--h)*0.085))`), never below 24 px at 1080 wide. Headline fills 60–80% of the width. Body ≥ 32 px in-feed.
- Content lives inside `.safe`; decorative layers (`.glow`, `.grain`) are full-bleed with `data-layout-ignore`.
- Initial hidden states with `gsap.set(...)` outside the timeline (lint `gsap_timeline_set_initial_hide`), never CSS transforms that a tween also animates. No tween on `display/visibility/autoAlpha` of a clip. No `<br>`.
- `{{#still}}`/`data-kind="still"`: the timeline stays empty and the end state is the static HTML. A still is rendered at its first frame.
- Motion: enter ≤ 0.8 s, exit ≈ 75% of entry along the same vector (current = LEFT: enter from the right, leave to the left), stagger ≤ 0.5 s total, no bounce/elastic, no idle wobble, hold ≥ 0.3 s before the climax. A seamless loop ends one frame before its first state. Durations from `--dur-*`, eases `power3.out` / `power3.in` / `power2.inOut` (`--ease-*`).
- Audio: `<audio id="vo" src="assets/vo.wav" data-start="0" data-duration="…">` (id mandatory); the plan's `audio.mix`/`audio.vo` is also what deliver.mjs mixes into the mp4, so templates reference audio only for preview.
- Captions: embed `captions.json` cues via `{{{json}}}` and render them in the bottom safe band (never over the device frame); keep `captions.srt/vtt` as sidecars (`plan.audio.captionsSrt`).
- Determinism: no Date/random/network; seeded SVG noise for grain; assets local under `assets/`.
- Each template ships a `README.md` with the params, the targets and one example `params.json`; run it through `build → proof → gate` on a real brand before calling it done.
