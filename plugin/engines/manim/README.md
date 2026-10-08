# Manim engine

The `explain` mode renders narrated, 3Blue1Brown-style episodes with Manim CE 0.21 (Typst math, no LaTeX) and a local voice (Kokoro or Piper). It runs in its own uv environment through `plugin/scripts/explain/run.sh`.

- `explainer/`: `ExplainerScene` (title, narrate, math, axes helpers), narration parser and lexicon, local TTS engines, narration lint, voice picker TUI.
- `bounds.py`: `BoundsMixin`, records every mobject's frame bounds for the explain gate.
- `glossary.toml`, `lexicon.toml`, `house-voice.toml`, `voices.toml`: defaults. A run overrides the first three with `--home <dir>`.
- `examples/residuals.py`: a complete episode to copy from.
- `tests/`: `uv run pytest` inside this directory.
