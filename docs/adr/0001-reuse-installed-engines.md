# ADR 0001: reuse the installed engines, own the glue

Date: 2026-10-08. Status: accepted.

## Context
HyperFrames 0.8.140, its skills, a motion doctrine with a seam gate and a working Manim explainer pipeline already existed. Most of the gates the first proposal listed already exist in them.

## Decision
compositor adds only the missing layers: brand resolution, platform fan-out, mode templates, mode gates, traces, and parametric SVG. It calls HyperFrames by CLI, owns small pure libs (`args`, `browser`, `encode`, `TARGETS`), invokes the optional `seam-gate.mjs` by path, and keeps the `explainer` Python package under `plugin/engines/manim/` with `theme.py` generated from `brand.json`.

## Consequences
The plugin tracks HyperFrames releases; CLI flags are wrapped in one module (`scripts/lib/hyperframes.mjs`) so a flag change is one edit. The only vendored third-party file is `gsap.min.js`; its `SOURCE` file records the version and license.
