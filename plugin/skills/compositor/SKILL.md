---
name: compositor
description: Media-generation harness. Use for any request to make brand media from a product repo — social posts (static or animated), ad creatives, promo or marketing videos, 3Blue1Brown-style math explainers, in-app tutorial videos, logos or parametric design assets — and for "compositor", "hacé un post/reel/ad/video/tutorial/logo", "assets para redes", "video explicativo", "guía narrada". Resolves the repo's brand tokens into brand.json, routes to one mode, authors with HyperFrames, Manim or the SVG generators, renders locally, gates deterministically and delivers dist/ per platform with a run trace. Not for editing the product's UI, not for isometric page mockups, not for talking-head footage.
argument-hint: "[social|ad|promo|explain|guide|mark|brand|verdict|runs] <brief>"
allowed-tools: Read Write Edit Glob Grep Bash AskUserQuestion Agent Skill
---

# compositor

You are the harness. Scripts own the order of the run; you author inside the steps and you never skip a gate. Everything is local and free: no API keys, no cloud render, no publishing. Plugin root: `${CLAUDE_PLUGIN_ROOT}` (P below). Contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`. Conventions for scripts: `${CLAUDE_PLUGIN_ROOT}/references/conventions.md`.

## 0. Parse the argument

`$ARGUMENTS` is `[mode] <brief>` or a command:

| First word | Do |
|---|---|
| `verdict <slug> publish\|reject [note]` | `node P/scripts/trace/run.mjs verdict --run compositor/runs/<slug> <verdict> [--note "…"]`, confirm in one line, stop. |
| `runs` | `node P/scripts/trace/run.mjs list --root compositor/runs`, show the table, stop. |
| `brand` | Call the Skill tool with `compositor:brand`, stop. |
| `social` `ad` `promo` `explain` `guide` `mark` | The mode is given. |
| anything else | Route by the brief (table below). If two modes fit equally, ask one question with the two options. A word that looks like a mode but is not one of the six (`video`, `banner`, `poster`…) is a brief, not a mode. A platform the targets table does not know (`node P/scripts/targets/presets.mjs` lists them; `target()` throws the supported list) stops the run with that list before any build. |

Routing by brief: a post, still, carousel, loop, "para instagram/linkedin/x" → `social`; an ad, bumper, campaign, CTA, offer, "anuncio", "pauta" → `ad`; a promo, launch video, product video, narrated clip, "video para redes" → `promo`; a math or concept explainer, "estilo 3blue1brown", a lesson, a theorem → `explain`; a tutorial, how-to, walkthrough of the running app, onboarding guide → `guide`; a logo, mark, icon set, favicon, parametric shape, pattern → `mark`.

## 1. Environment and brand

1. `node P/scripts/doctor.mjs --quiet`. If it exits 1, show the missing line and its fix and stop.
2. If `compositor/brand.json` is missing: `node P/scripts/brand/resolve.mjs --root . --out compositor/brand.json`. Read its summary line, `conflicts[]` and `warnings[]`. Ask the user only in the five cases in `P/references/brand.md`; otherwise state the inferred values in one line and continue. Add `compositor/runs/*/project`, `compositor/runs/*/proof`, `compositor/runs/*/dist` and `compositor/fonts` to `.gitignore` if absent.

## 2. Run the mode

Call the Skill tool with `compositor:<mode>` and pass the brief. The mode skill follows the run contract: init the trace, plan (the `compositor:director` agent plans anything with three or more scenes, every ad, promo and guide), confirm once, build, proof, gate (repair at most three rounds), deliver, gate again, trace, report.

## 3. Report

End with: the `dist/README.md` table, the path of `proof/sheet.png`, the gate table, the director's top fix if it ran, and the verdict command: `/compositor verdict <slug> publish` or `reject`. Say plainly what failed if something did; never describe the result as award-winning.

## Hard rules

- Never run `hyperframes capture` without `--skip-vision`, `snapshot` without `--describe false`, `media-use` without `--local-only`; never `publish`, `cloud`, `auth`.
- The director's findings never change a gate result. Gates decide; the director advises.
- Brand truth wins over house taste: a flagged indigo accent stays indigo.
- A run that cannot pass its gates after three rounds stops and reports; it does not lower the gate.
