# compositor

A media-generation harness for Claude Code. Inside a product repo, `/compositor <brief>` resolves the brand (DESIGN.md, Tailwind `@theme`, shadcn vars, DTCG tokens, `next/font`, logos) into `compositor/brand.json`, routes the brief to one mode, authors with the installed engines, renders locally, runs deterministic gates and delivers `dist/` per platform with a run trace. No API keys, no cloud, no publishing.

| Mode | Makes | Engine |
|---|---|---|
| `social` | stills for feed and link previews, 6 s seamless loops | HyperFrames |
| `ad` | static display/feed ads, 6 s bumpers, 15 s vertical ads, carousels (PDF), end cards | HyperFrames |
| `promo` | 15–30 s narrated or captioned product videos, landscape and vertical | HyperFrames + Kokoro TTS + parakeet/whisper captions |
| `explain` | 3Blue1Brown-style math explainers, narrated | Manim CE 0.21 + Typst (`engines/manim` package) |
| `guide` | in-app tutorials captured from the running app: device frame, cursor, auto-zoom, captions | puppeteer-core capture + HyperFrames overlay |
| `mark` | parametric marks, logos, icon packages, brand sheet | SVG generators + sharp |

## Install (local, loads in place)

```sh
cd plugin && pnpm install
claude plugin marketplace add /path/to/compositor        # the repo root holds .claude-plugin/marketplace.json
claude plugin install compositor@compositor-local
node plugin/scripts/doctor.mjs                           # node ≥ 22, hyperframes, ffmpeg, chromium; optional: magick, uv (explain), Kokoro (promo/guide)
bash plugin/scripts/explain/run.sh setup                 # explain mode only: uv env + voice
```
Edits take effect after `/reload-plugins`.

## Run layout (in the product repo)

```
compositor/brand.json  compositor/fonts/
compositor/runs/<slug>/{brief.md, plan.json, params.json, project/<target>/index.html, proof/sheet.png, gates.json, findings.md, run.json, dist/<target>/…, dist/README.md}
```
Verdicts: `/compositor verdict <slug> publish|reject`. List: `/compositor runs`.

## Scripts (all local, `--json` everywhere)

`scripts/brand/resolve.mjs` · `scripts/brand/theme.mjs` · `scripts/render/{build,proof,deliver}.mjs` · `scripts/gates/gate.mjs` (+ `check probe palette loudness ad-lint guide-lint seams logo-gate explain-lint`) · `scripts/targets/{presets,encode}.mjs` · `scripts/mark/package.mjs` · `scripts/guide/{capture-steps,narration,captions,plan}.mjs` · `scripts/promo/{voiceover,plan}.mjs` · `scripts/explain/run.sh` · `scripts/trace/run.mjs` · `scripts/doctor.mjs`. Contracts: `references/`.

Tests: `cd plugin && pnpm test`.
