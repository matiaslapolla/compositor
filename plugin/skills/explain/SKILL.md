---
name: explain
description: 3Blue1Brown-style math and concept explainers, narrated, from Manim CE 0.21 with Typst math and a local Kokoro/Piper voice, themed from brand.json. Use for "explainer", "video explicativo", "estilo 3blue1brown", "animá esta fórmula/teorema", "lección sobre", "clase en video".
argument-hint: "<topic or outline> [--lang es|en] [--minutes 1] [--yes]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# explain

Authoring contract (helpers, Typst syntax, vetted API, narration rules, the proof → bounds → render loop): `${CLAUDE_PLUGIN_ROOT}/references/explain.md`. Engine: `${CLAUDE_PLUGIN_ROOT}/scripts/explain/run.sh`. Run contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`.

## Setup (once)

`bash P/scripts/explain/run.sh doctor`; if it fails, `bash P/scripts/explain/run.sh setup` (uv env in `${CLAUDE_PLUGIN_DATA}/manim`, voice download). `sox` is optional.

## Plan (director agent for anything over one beat)

1. Slug `compositor/runs/<date>-explain-<topic>`; init the trace.
2. Theme: `node P/scripts/explain/theme-from-brand.mjs --brand compositor/brand.json --out R/theme.json [--mode dark]` (also copies fonts and writes `fonts.conf`).
3. Storyboard first, code second: `plan.md` lists beats (≤ 8 for a minute): what is on screen, what the voice says (STE: ≤ 20 words per sentence, ≤ 3 sentences per beat, one term per concept), which helper draws it (`narrate`, `voiceover` + bookmarks, `math` in **Typst**, `axes`, `chapter`). Confirm once unless `--yes`.

## Author → proof → gate → render

1. Write `R/episode.py` with `class Episode(BoundsMixin, ExplainerScene)` using only the vetted API subset. Typst math, never LaTeX.
2. `bash P/scripts/explain/run.sh lint R/episode.py --json`; fix every error.
3. `bash P/scripts/explain/run.sh preview R/episode.py --out R/proof --theme R/theme.json` (480p15) then `frames R/proof/Episode.mp4 --out R/proof/frames`; read the contact sheet. Read `R/proof/bounds.json`: offscreen = fix the layout, overlap = reposition. Retry cap 5; layout failures go back to the storyboard, not the code.
4. Record `plan.explain = { episode: "episode.py", theme: "theme.json", bounds: "proof/bounds.json", video: "proof/Episode.mp4" }` and run `node P/scripts/gates/gate.mjs --run R --stage proof --mode explain --brand compositor/brand.json`.
5. `bash P/scripts/explain/run.sh render R/episode.py --out R/dist/explain --theme R/theme.json` (1080p60 + SRT). Update `plan.explain.video` to the render, gate at `--stage dist`, trace.

## Report

The mp4 + srt paths, duration, lint and bounds results, the sheet, and the one change that would raise it most (usually a tighter storyboard or one more `wait_until_bookmark`).
