---
name: brand
description: Resolve or audit a repo's brand tokens into compositor/brand.json (DESIGN.md, Tailwind @theme, shadcn vars, DTCG tokens, next/font, logos) with provenance, conflicts and slop warnings; emit brand.css or the Manim theme. Use for "resolve the brand", "audit brand.json", "refresh brand tokens", "qué colores/fuentes detectó", or before any compositor run in a new repo.
argument-hint: "[--refresh] [--audit]"
allowed-tools: Read Bash Glob Grep AskUserQuestion
---

# brand

Reference: `${CLAUDE_PLUGIN_ROOT}/references/brand.md`.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/brand/resolve.mjs --root . --out compositor/brand.json $ARGUMENTS` (`--refresh` rebuilds; `--no-fonts` skips font materialization).
2. Read the summary line, then `conflicts[]` and `warnings[]` from the file. For each conflict say which source won and why (precedence: DESIGN.md → tokens.json → @theme/shadcn CSS). For each warning say whether it is a slop flag (brand truth kept) or a missing asset (logo, font) and what fixes it at the source.
3. Ask the user only in the five ask-cases (no logo, accent disagreement without DESIGN.md, more than two font families, undeterminable mode, no name). Otherwise report the inferred fields (`provenance.*.confidence = inferred|default`) in one list and stop.
4. `--audit`: also print the contrast table (`color.contrast`) rows that fail AA, the fonts without local files, and the roles whose provenance is `default`.

Never edit `brand.json` by hand. The fix belongs in DESIGN.md or the CSS; then `--refresh`.
