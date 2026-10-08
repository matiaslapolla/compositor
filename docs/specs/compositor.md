# compositor — spec

Status: v1 built (2026-10-08). Owner: Matias Lapolla. Research: `docs/research/`.

## Problem

Products need media (social posts, ads, launch loops, tutorials, math explainers, logo assets). The installed skills cover most of the authoring but each one is invoked alone, only `hyperframes-creative` reads `DESIGN.md`, nothing reads Tailwind `@theme`, nothing fans one source out to every platform, and no run leaves a trace. `compositor` is one plugin that resolves the brand, routes to a mode, authors with the installed engines, renders locally, gates deterministically and delivers per platform with a trace.

## Non-goals

- AI image generation, HeyGen cloud, Gemini vision, any API key. Zero monetary cost; the budget is session tokens.
- Replacing HyperFrames, Manim or the existing skills. compositor orchestrates them and adds the missing layers.
- A GUI. The chat shows the plan, the proof sheet and the gate table; files land in the repo.
- Publishing to platforms.
- A quality judge as a gate. The director agent is advisory until its agreement with the user reaches 70%.

## Core thesis

Brand truth comes from the repo, normalized once into `brand.json` with provenance. Every mode authors from that file against the HyperFrames composition contract (or the Manim explainer package, or the SVG generators), proves on a few frames, passes deterministic gates, then renders and fans out. The render is the truth. Each run writes a trace the next run can learn from.

## Plugin contract

Repo layout (the repo is a local marketplace; the plugin lives in `plugin/`):

```
compositor/
  .claude-plugin/marketplace.json        # name compositor-local, plugins: [{ name: compositor, source: ./plugin }]
  plugin/
    .claude-plugin/plugin.json           # name compositor, version 0.1.0 (validate --strict wants one; in-place load ignores it)
    skills/
      compositor/SKILL.md                # entry: resolve brand, route, run the workflow
      brand/SKILL.md                     # /compositor:brand  resolve or audit brand.json
      social/SKILL.md                    # static + animated social assets
      ad/SKILL.md                        # ad creatives (static, bumper, reels-ad, carousel, display)
      promo/SKILL.md                     # marketing videos for social (narrated or captioned)
      explain/SKILL.md                   # 3b1b-style math explainers (Manim)
      guide/SKILL.md                     # in-app tutorials from the running app
      mark/SKILL.md                      # parametric shapes, logos, icon packages
    agents/
      director.md                        # opus: creative plan + advisory review of proof sheets
      composer.md                        # sonnet: authors one scene or composition from a packet
      verifier.md                        # haiku: condenses gate JSON into a findings table
    scripts/                             # Node ≥ 22 ESM, no build step
      brand/   resolve.mjs  schema.json  sources/*.mjs  theme.mjs
      targets/ presets.mjs  encode.mjs            # fan-out lives in render/build.mjs (safe-box vars per target)
      gates/   gate.mjs  common.mjs  check.mjs  offline.mjs  palette.mjs  seams.mjs  probe.mjs  loudness.mjs  social-lint.mjs  ad-lint.mjs  promo-lint.mjs  guide-lint.mjs  explain-lint.mjs  logo-gate.mjs
      render/  build.mjs  proof.mjs  deliver.mjs   # stills are one-frame compositions delivered by deliver.mjs
      guide/   capture-steps.mjs  narration.mjs  captions.mjs  plan.mjs  overlay.mjs
      promo/   voiceover.mjs  plan.mjs
      mark/    generators/*.mjs  geom.mjs  compose.mjs  package.mjs  sheet.mjs
      explain/ run.sh  theme-from-brand.mjs
      trace/   run.mjs                            # init, record, usage, verdict, list
      doctor.mjs
      lib/     args.mjs  browser.mjs  ffmpeg.mjs  color.mjs  svg.mjs  fs.mjs
    engines/
      manim/explainer/                   # Manim explainer engine, brand-themed
      manim/pyproject.toml
    templates/                           # HyperFrames compositions per mode, brand-driven via CSS vars
    references/                          # platform matrix, craft rules, rubric, vocabulary
    hooks/hooks.json                     # SessionStart: doctor.mjs --quiet (reports what is missing; setup stays explicit: run.sh setup)
    package.json                         # deps: culori, d3-delaunay, polyclip-ts, opentype.js, yaml (sharp + puppeteer-core from hyperframes)
    tests/                               # node --test
  docs/ ideas/ specs/ plans/ adr/ research/
```

Install: `claude plugin marketplace add matiaslapolla/compositor` (or a local clone path) then `claude plugin install compositor@compositor-local`. Edits need `/reload-plugins`. `claude plugin validate plugin --strict` must pass.

## Run contract

`/compositor <brief>` (or `/compositor:<mode> <brief>`) inside a product repo:

1. **Brand.** `scripts/brand/resolve.mjs --root . --out brand.json` (skipped if `brand.json` exists and `--refresh` is absent). Provenance per field; `conflicts[]`, `warnings[]`. The skill asks the user only in the five cases listed in `docs/research/brand-tokens.md`.
2. **Route.** The entry skill names the mode from the brief (one mode per run) and reads that mode's skill. Unknown platform or mode: stop with the supported list.
3. **Plan.** The director agent (opus) writes `plan.md`: goal, audience, one message, shot list or slide list with timing, targets, copy, narration, the sustained-motion route per scene (motion-doctrine), and the eval row it maps to. The user confirms once (AskUserQuestion) unless `--yes`.
4. **Author.** The mode skill (session model) or composer agents (sonnet, one per scene when ≥ 3 scenes) write the project from `templates/` and `brand.json` (CSS vars in `:root`, fonts as local `@font-face`, no CDN). Manim scenes are Python episodes; marks are generator calls.
5. **Proof.** `scripts/render/proof.mjs` renders 5 frames per composition (`hyperframes snapshot --describe false` or a seek path for single-file comps) into `proof/sheet.png`. The director reviews the sheet and writes findings (advisory). The gates run on the proof.
6. **Gate.** `scripts/gates/gate.mjs --run <runDir> --stage proof|dist --brand <brand.json> --mode <mode>` runs every gate for the mode (targets come from `plan.json`) and exits non-zero with the failing rules; a report where every gate skipped also exits non-zero. Repair: one round per gate class, three rounds total, then stop and report.
7. **Deliver.** `scripts/render/deliver.mjs` renders one PNG sequence per composition × target, encodes per platform preset, writes `dist/<target>/…` and `dist/README.md` (table: target, size, duration, codec, loudness, gate status). Gates run again on `dist/`.
8. **Trace.** `scripts/trace/run.mjs` writes `compositor/runs/<slug>/run.json`: brief, brand hash, mode, plan, gate results, fix rounds, director findings and ratings, the session-window delta from `hyperframes usage --json` (percent of the Max window, the only budget the CLI reports), `verdict: null`. `/compositor verdict <slug> publish|reject` fills it. The repair limit (one round per gate class, three in total) is enforced by the skills' procedure and recorded in `fixRounds`; no script blocks a fourth round.

Working folder: `compositor/runs/<slug>/` in the product repo, beside `compositor/brand.json` and `compositor/fonts/`; `project/`, `proof/` and `dist/` are gitignored by the entry skill, `brief.md`, `plan.md`, `plan.json`, `gates.json`, `findings.md` and `run.json` are kept.

## Modes

| Mode | Input | Engine | Deliverables (defaults) | Mode gates beyond the common ones |
|---|---|---|---|---|
| `social` | copy or claim, optional product capture | HyperFrames | still: ig-feed, ig-square, x-image, linkedin-image; motion: ig-square + reels 4–8 s seamless loop | `social-lint`: headline ≤ 7 words; seamless loop closes (first vs last frame diff ≤ 2% at dist). Type minimums are template defaults, not a gate. |
| `ad` | offer, CTA, audience, platform | HyperFrames | static (gda-*, ig-feed, linkedin-image), bumper 6 s, reels-ad/stories-ad 15 s, carousel 5–7 slides, end card | `ad-lint`: craft rules 1, 3, 5, 7, 8, 9, 10 measured (first change, hook words, captions, end card, bumper, duration ladder, flashes); safe boxes via `check --caption-zone` and the template's `.safe`; rules 2, 4, 6, 11–18 are template defaults and director review; −14 LUFS by `loudness` |
| `promo` | brief or URL, optional narration | HyperFrames + Kokoro TTS + whisper/parakeet | 15–30 s landscape + reels; captions burned + SRT/VTT | `promo-lint`: captions carry ≥ 95% of the narrated words (mute-mode); `seams` on the ledger; `loudness` |
| `explain` | topic, outline or script, language | Manim CE (`engines/manim/explainer`) | 1080p60 mp4 + SRT; optional 9:16 recut | narration lint (≤ 25 words, 3 sentences per beat, glossary); brand theme hex ⊆ palette; bookmarks land |
| `guide` | app URL, steps (selector, action, narration, caption) | puppeteer-core capture + HyperFrames overlay (cursor, zoom, spotlight, chips, captions) | 1920×1080 mp4 + SRT/VTT, yt-landscape, 9:16 crop, caption-only variant | `guide-lint`: rules 5, 7, 8, 10 measured (zoom, pace, narration, captions); rules 1–4, 6, 11–15 are capture/overlay defaults |
| `mark` | concept, generator family, wordmark text, or existing logo | SVG generators + sharp | logo package (`docs/research/parametric-logos.md` §4): SVG master, mono, construction, lockups, rasters, favicon set, maskable, avatar, OG, brand sheet | stroke ≥ 1 px @16, counters ≥ 2 px @32, no gradients/filters in master, maskable safe zone, mono single fill |

## brand.json

Schema per `docs/research/brand-tokens.md` Part 3: `identity`, `color` (roles per mode as `{oklch, hex}`, `video`, `contrast`), `type` (display/body/mono with sources and files, scale, tracking, video minimums), `spacing`, `radius`, `shadow`, `motion` (fps, direction, register, video durations, easing roles → GSAP, stagger, forbidden), `imagery`, `voice`, `platforms`, `provenance`, `conflicts`, `warnings`. Resolution order 1–11 and conflict rules as in that document. OKLCH is gamut-mapped to sRGB hex with `culori`. Fonts are materialized to `assets/fonts/*.woff2` so `font_family_without_font_face` never fires. `scripts/brand/theme.mjs` emits `brand.css` (`:root` vars) for HyperFrames templates; `scripts/explain/theme-from-brand.py` emits the Manim `theme.py` values.

## Targets and encoding

`scripts/targets/presets.mjs` = the base `TARGETS` + the additions in `docs/research/ads-and-tutorials.md` (`reels-ad`, `stories-ad`, `tiktok-ad`, `shorts-ad`, `yt-thumbnail`, `x-square`, `linkedin-portrait`, `linkedin-document`, `gda-*`, `pinterest-pin`, `threads-*`, `bluesky-*`), each with size, safe box, kind, duration bounds, size cap, fps, bitrate guidance. `encode.mjs` = the base presets + BT.709 tags, CRF ladder 18/20/23, two-pass `loudnorm`, size-cap bitrate solver, YouTube profile. `fanout.mjs` writes one root composition per target from one scene by anchoring a `safe-box` layer (author once at the mode's master ratio, reflow text blocks, never scale type below the minimum).

## Gates (deterministic, exit code is the verdict)

Common: `hyperframes check --strict --caption-zone … --frame-check --json` (one project per target; a missing project or CLI fails the gate); `offline` (no http(s) reference, every `@font-face` file present); `ffprobe` fields vs preset; palette (`palette.mjs`: hex set in the HTML and sampled proof pixels ⊆ brand roles ± ΔE 0.02); fonts local; no network references; `seam-gate.mjs verify` when `ledger.json` exists; `loudness.mjs` (ffmpeg `ebur128`) when audio exists; file size ≤ cap. Mode gates as in the table. Every gate prints JSON `{rule, status, evidence, hint}`; `gate.mjs` aggregates; check and palette run on `project/` at both stages (the authored source), probe and loudness on `dist/`. The verifier agent (haiku) turns the aggregate into a table for the chat only when the JSON exceeds a few KB.

## Agents

- `director` (opus, tools Read/Glob/Grep/Bash read-only): preloads `references/rubric.md`, `motion-doctrine`, `web-design` prohibited directions and slop checklist, the mode's craft rules. Writes `plan.md`; reviews `proof/sheet.png` and writes `findings.md` with a 1–5 rating per rubric axis into `run.json`. Never edits the project.
- `composer` (sonnet, tools Read/Write/Edit/Bash): receives one packet (scene brief, `brand.css`, template path, timing, motion route) and writes one composition file that passes `hyperframes lint`. Parallel across scenes.
- `verifier` (haiku, tools Read/Bash): runs `gate.mjs --json` and returns the failures as a table with the fix hint from `references/gates.md`.

Model names in frontmatter: `opus`, `sonnet`, `haiku`. The skill `agent:` field for plugin agents is unverified; if it fails, the skills call the Agent tool with the scoped name.

## Decisions

- D1 Shape: Claude Code plugin loaded in place from a local marketplace (`docs/research/claude-code-plugins.md`). Skills carry the procedures; agents carry the roles; scripts carry every deterministic step.
- D2 Reuse first: HyperFrames CLI for render/check/snapshot/tts/transcribe; small `args`, `browser` and `encode` libs and the base `TARGETS` owned in `scripts/lib` and `scripts/targets`; `motion-doctrine/scripts/seam-gate.mjs` invoked by path; the `explainer` package under `engines/manim/` with `theme.py` generated from `brand.json` (ADR 0001).
- D3 Rung 2: scripts own the control flow; the model authors inside fixed steps; subagents only for parallel scenes and context hygiene; the director never gates (ADR 0002).
- D4 Trace every run; the verdict is the label. 20 rated runs unlock the director agreement test.
- D5 Local only: `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1`, `--describe false`, `--skip-vision`, `media-use --local-only`, vendored GSAP, local fonts. Any step that needs a key is a bug.
- D6 Author once, reframe per target through safe boxes (safe boxes generalized per target).
- D7 Colour: OKLCH source, sRGB hex in compositions, BT.709 tags in encodes, near-black instead of `#000`, grain on dark gradients, no full-screen linear gradient on dark.
- D8 Motion defaults from `brand.json.motion`, derived from UI tokens × 3.5 or house defaults (`power3.out` 0.6 s, current LEFT, exit 75%, stagger 0.08 ≤ 0.5 s total, bounce/elastic forbidden).
- D9 Explainers: Manim CE 0.21 + Typst from the `explainer` package (manim-voiceover, Kokoro/Piper voice service with word timing, narration lint), rendered by Manim at 1080p60; a HyperFrames wrap hosts the render for captions, title cards and 9:16 recuts. MathJax SVG + MorphSVG inside HyperFrames only for short equation or graph beats in `social`/`promo` (ADR 0003, `docs/research/math-engines.md`).
- D10 Marks: pure-function generators, `sharp` rasterization, outlined text via `opentype.js`, hand-packed ICO; Chromium only for the brand sheet and OG image.

## Verified numbers (2026-10-08, this machine: 12 cores, RTX 3050 unused, SwiftShader)

| Step | Time |
|---|---|
| brand resolution, a monorepo (15 CSS files, DESIGN.md tables), with fonts | < 2 s |
| brand resolution, Manrope from Google Fonts (10 woff2) | ~4 s (network) |
| build 3 targets from `social/claim` | < 1 s |
| proof: 5 snapshots × 2 motion targets + 1 still + contact sheet | 10 s |
| proof-stage gates (check × 3 projects, palette) | 18 s |
| 6 s loop at 1080², 30 fps: png sequence + mp4 encode | ~12 s |
| still 1200×627 | ~1 s |
| Manim explainer 28 s episode, 480p15 preview (cold TTS) / 1080p60 render | 16 s / 34 s |
| guide capture, 3 steps at 2880×1800 | 5 s |
| guide narration, 3 steps, Kokoro cold / cached | 18 s / 0.7 s |
| logo package, 28 files incl. brand sheet via Chromium | a few seconds (reported by the mark build) |

Tokens per run: to be read from `run.json.usage.sessionDelta` over the first real runs.

## Open follow-ups

- Logo legibility SSIM threshold (set from the first 5 marks).
- Director agreement measurement after 20 rated runs.
- 9:16 recut of Manim explainers (Manim renders one ratio; recut via HyperFrames crop or a second render with `--resolution`).
- Figma source (needs `FIGMA_TOKEN`; Enterprise-only variables API).

## Acceptance criteria

- [x] `claude plugin validate plugin --strict` passes; `claude --plugin-dir plugin` loads the 8 skills and 3 agents (smoke test `/compositor runs`). Marketplace install happens from `main` after the merge.
- [x] `node plugin/scripts/brand/resolve.mjs --root <repo>` produces a schema-valid `brand.json` for repos with a DESIGN.md and for repos with only `@theme`/shadcn, with `provenance` on every field and `exact` confidence for the accent in all of them.
- [x] Every colour in `brand.json` has `oklch` and an sRGB `hex`; every font has local woff2 files (Google subsets or copied local faces) or a bundled-font flag; `hyperframes check` on the generated projects reports no `font_family_without_font_face`.
- [x] `presets.mjs` holds 41 targets (the base set plus the additions), each with size, safe box, kind, duration bounds, size cap; `tests/targets.test.mjs` checks every safe box is inside the frame.
- [x] `social` mode from one template delivers stills and 6 s loops per target (verified ig-square loop + linkedin-image still); `gate.mjs` exits 0 at proof and dist; `dist/README.md` lists each file with ffprobe-verified fields.
- [x] `ad` mode delivers a 6 s bumper, a 15 s reels-ad and a 6-slide carousel (PNG + PDF); `ad-lint.mjs` measured first change 0.033 s, ≤ 1 flash/s, static end card ≥ 2 s, headline ≤ 7 words; loudness gate skips without audio (ads are silent by default).
- [x] `promo` mode produces a 19 s narrated clip (Kokoro `ef_dora`, Spanish) with burned captions from whisper word timestamps and SRT/VTT sidecars; the transcript of the render matches the narration at 100% word accuracy; seams, loudness (−14.1 LUFS) and probe pass.
- [x] `explain` mode renders `examples/residuals.py` through the engine with the theme from a `brand.json` (1080p60 in 34 s); narration lint passes; sampled background ΔE 0.0064 to the brand bg (`explain-lint` pass).
- [x] `guide` mode captures a running app (fixture app, 3 steps) and renders a 14.8 s 1920×1080 tutorial with cursor, ripple, zoom groups ≤ 2×, chips, captions and SRT/VTT; `guide-lint.mjs` enforces pace and caption length; proof and dist gates pass. Caption-only variant implemented, not rendered end to end yet.
- [x] `mark` mode produces the 28-file package from a generator spec; `logo-gate.mjs` verifies stroke at 16 px, counters at 32 px, no gradients/filters, maskable zone, single-fill mono (8 rules pass on a monogram and an isometric stack); `favicon.ico` opens in Chromium.
- [x] Every run writes `compositor/runs/<slug>/run.json` (brief, brand hash, mode, plan, gates, fix rounds, director, usage delta, verdict); `/compositor verdict <slug> publish|reject` updates it (`scripts/trace/run.mjs`).
- [x] No step requires a network call or API key after setup: under `unshare -rn` (loopback only) a `social/claim` run completed build → proof → gates → deliver → dist gates (pass) and the `mark` package built with its gate measuring (wordmark skipped without a font).
- [x] Director findings never change `gate.mjs` exit codes (the aggregator reads no findings.md); the director is an advisory agent the skills call for planning and review.
- [ ] `node --test 'plugin/tests/**/*.test.mjs'` passes (146 tests).
