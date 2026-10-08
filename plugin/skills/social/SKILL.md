---
name: social
description: Social assets from the brand - stills for feed and link previews and seamless loops for square and vertical video - from one claim. Use for "post", "still", "carousel", "loop", "asset para instagram/linkedin/x", "imagen para el link", "reel corto sin audio".
argument-hint: "<claim or brief> [--targets ig-square,reels] [--canvas dark|light] [--yes]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# social

Follow `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`. Templates: `node ${CLAUDE_PLUGIN_ROOT}/scripts/render/build.mjs --list --mode social` (today `social/claim`; the `ad/carousel` and `ad/static-ad` templates also serve organic posts).

## Plan (session, no agent unless ≥ 3 variants)

1. Slug: `compositor/runs/<yyyy-mm-dd>-social-<kebab claim>` (`slugify`). Init the trace with `--eval` when the brief names a brief row.
2. Copy: headline ≤ 7 words, in the brand's voice (`brand.voice.tone`), no claims the product does not make (read `CONTEXT.md`/`docs/specs` if the brief is thin). Optional subline ≤ 16 words, kicker ≤ 4, CTA ≤ 4. Spanish or English as the brief.
3. Targets: default `ig-feed, ig-square, x-image, linkedin-image` (stills) + `ig-square, reels` (6 s seamless loops). Honour `--targets`.
4. Canvas: `brand.color.video.canvasDefault` unless `--canvas`.
5. Write `params.json` (`headline, subline, kicker, cta, accent: rule|block|none, align`). Write `plan.md` (3 lines: message, targets, canvas). Confirm once with AskUserQuestion (confirm / change copy / change targets) unless `--yes`.

## Build → proof → gate → deliver

As in the run contract with `--template social/claim`. Look at `proof/sheet.png` yourself before the gate: headline fills 60–80% of the width, nothing touches the safe box edges, the loop's first and last frames are both empty of content (seamless), the accent rule is the only accent. Fix params (shorter headline, `align`, `accent`) before touching the template. Gates: `check`, `palette` (+ `probe` at dist). Loop check: `proof --at 0,5.97` must look identical.

## Report

README table, sheet path, gate table, and the one change that would raise quality most (usually a real product capture instead of a type-only still: say so).
