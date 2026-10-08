# ADR 0003: Manim CE with Typst for explainers; HTML-native for short math beats

Date: 2026-10-08. Status: accepted.

## Context
`docs/research/math-engines.md`: Manim CE 0.21 renders on Python 3.14 with `MathTypst` and no TeX; an existing pipeline already provided `ExplainerScene`, a Kokoro/Piper voice service with word timing, and a narration linter. Motion Canvas has no headless path. HTML-native MorphSVG works for graph and glyph morphs but has no `TransformMatchingTex`, fields or 3D.

## Decision
`explain` mode uses the `explainer` package in `plugin/engines/manim/` on Manim CE 0.21 + Typst, rendered by Manim at 1080p60. A HyperFrames wrap (title card, captions, 9:16 recut) hosts the Manim render as a clip when the brief asks for social cuts. Short equation or graph beats inside `social`/`promo` use MathJax SVG + MorphSVG in HyperFrames. The skill writes Typst math, pins `manim==0.21.*`, proofs at `-ql` with last-frame PNGs per beat, runs a bounds check, caps retries at 5 and routes layout failures to the storyboard.

## Consequences
Two renderers in one harness, one per domain. The Python environment lives in `${CLAUDE_PLUGIN_DATA}` via `uv`, installed by the SessionStart hook or `scripts/explain/run.sh --setup`.
