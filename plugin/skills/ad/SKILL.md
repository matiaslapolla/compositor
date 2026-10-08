---
name: ad
description: Ad creatives from the brand - static display and feed ads, 6 s bumpers, 15 s vertical reels/stories/tiktok ads, carousels and end cards - with the ad lint (hook timing, end card hold, flash limit, safe zones, loudness). Use for "ad", "anuncio", "pauta", "campaña", "bumper", "creativo para meta/google/tiktok", "carrusel de ventas".
argument-hint: "<offer, audience, platform> [--format static|bumper|reels|carousel] [--yes]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# ad

Run contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`. Templates and their params: `node ${CLAUDE_PLUGIN_ROOT}/scripts/render/build.mjs --list --mode ad` and each `templates/ad/<name>/README.md`. Craft rules the gate enforces: `${CLAUDE_PLUGIN_ROOT}/references/gates.md` (`ad.*`).

## Plan (always the director agent)

1. Slug `compositor/runs/<date>-ad-<offer>`; init the trace.
2. Delegate the plan to `compositor:director` ("plan" mode) with the brief, the brand path and the format: it returns `plan.md` and a params draft. Formats → templates: static → `ad/static-ad` (gda-landscape, gda-square, ig-feed, linkedin-image); bumper → `ad/bumper-6s` (yt-landscape, reels-ad, ig-square); reels → `ad/reels-ad-15s` (reels-ad, stories-ad, tiktok-ad, shorts-ad); carousel → `ad/carousel` (ig-feed, linkedin-portrait, linkedin-document); every motion format ends on its own end card. One format per run; a campaign is several runs.
3. Copy limits are gates: headline ≤ 7 words, CTA present, bumper text ≤ 5 words, carousel 5–7 slides with slide 1 the hook and the last slide CTA only. Legal line optional (`legal`).
4. Confirm once (AskUserQuestion: confirm / change offer line / change platform) unless `--yes`.

## Build → proof → gate → deliver

Per the contract with the chosen template. Read `proof/sheet.png`: one focal element, the hook inside the ad safe box (top 14%, bottom 35% on reels-ad), CTA contrast, nothing touching the frame edge. `gate.mjs --mode ad` at proof checks structure; `ad-lint` measures the real frames only at `--stage dist` (first change ≤ 0.5 s, end card static ≥ 1.5 s, ≤ 3 luminance changes per second, duration ladder, −14 LUFS when audio). Fix params first, template second, three rounds, then stop.

## Report

README table (every file with size and duration), the sheet, the gate table with `ad.*` evidence, and the one change that would raise performance most (usually a product capture or a stronger first frame).
