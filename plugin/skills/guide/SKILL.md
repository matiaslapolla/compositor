---
name: guide
description: Narrated or caption-only in-app tutorial videos captured from the running product - Screen Studio style device frame, oversized cursor, auto-zoom on clicks, spotlight, step chips, burned captions with SRT/VTT - from a steps.json. Use for "tutorial", "guía de uso", "how-to del producto", "onboarding video", "walkthrough", "mostrá cómo se hace X en la app".
argument-hint: "<task to show> --url http://localhost:3000 [--lang es|en] [--caption-only] [--yes]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# guide

Run contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`. Steps contract, narration rules, voices and timeline: `${CLAUDE_PLUGIN_ROOT}/references/guide.md`. Flow: `${CLAUDE_PLUGIN_ROOT}/templates/guide/README.md`.

## Plan (director agent for ≥ 3 steps)

1. The app must be running (`--url`). If not, say which command starts it (read the repo's `package.json`) and stop; never start servers that need credentials you do not have. Seed data and a stable login are the user's job; ask once if the flow needs them.
2. Slug `compositor/runs/<date>-guide-<task>`; init the trace.
3. Inspect the pages yourself (Read the app's components for selectors, or `npx hyperframes capture <url> --skip-vision` for a quick DOM) and write `R/steps.json`: 3–8 steps, each `{ id, action, selector, text?, narration, caption, zoom? }`; narration verb-first with the exact UI label, ≤ 12 words; captions ≤ 42 chars. `node P/scripts/guide/capture-steps.mjs --steps R/steps.json --dry` validates it. Confirm once unless `--yes`.

## Capture → narration → plan → build → proof → gate → deliver

```
node P/scripts/guide/capture-steps.mjs --url <url> --steps R/steps.json --out R/project/_shared/assets/captures [--locale es]
node P/scripts/guide/narration.mjs --manifest R/project/_shared/assets/captures/manifest.json --out R/project/_shared/assets --voice <af_heart|ef_dora> --speed 0.9 [--caption-only]
node P/scripts/guide/plan.mjs --run R --manifest … --timeline R/project/_shared/assets/timeline.json --captions R/project/_shared/assets/captions.json --title "…" [--caption-only] [--spotlight]
node P/scripts/render/build.mjs --run R --template guide/tutorial --params R/params.json --brand compositor/brand.json --targets landscape
```
plan.mjs adds a 1.5 s title card and end frame, shifts the mix and captions by the intro (`vo/guide-mix.wav`, `guide-captions.srt/vtt`), blanks typed fields for the typing reveal and measures each click's result region so the camera pans to the effect. Read the plates (`captures/*.png`) before building: a cookie wall, an empty lazy section or a wrong state means a selector or a `wait` step, not a template fix. Proof at the title, one travel, one click + 0.2 s, one zoomed hold, the end; read the sheet (cursor on target, zoom not cropping the UI, chip outside the frame, captions in the band). Gate at proof (`check`, `palette` warns on captured UI, `guide-lint`: pace 2–4 s per action, zoom ≤ 2.5, captions ≤ 42 chars, verb-first). Deliver `landscape` (and `yt-landscape`/`reels` when asked), gate at dist (`probe`, `loudness` −16 LUFS narration-only). Localization: one steps.json per locale, re-capture with the app's locale.

## Report

README table, the sheet, the gate table, measured WPM, and the one change that would raise it most (usually a real app state instead of a cursor-only click).
