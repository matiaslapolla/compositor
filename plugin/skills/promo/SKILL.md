---
name: promo
description: Promo and marketing videos for social from the brand - 15 to 30 s, narrated with a local Kokoro voice or caption-only, scenes that cut along one direction with captions burned and SRT/VTT sidecars - landscape and vertical. Use for "promo", "video de lanzamiento", "product video", "video para redes con voz", "clip narrado", "video de 20 segundos".
argument-hint: "<brief or URL> [--lang es|en] [--voice ef_dora|af_heart] [--caption-only] [--yes]"
allowed-tools: Read Write Edit Bash Glob AskUserQuestion Agent
---

# promo

Run contract: `${CLAUDE_PLUGIN_ROOT}/references/run-contract.md`. Flow and params: `${CLAUDE_PLUGIN_ROOT}/templates/promo/README.md`. Motion law: `~/.claude/skills/motion-doctrine/SKILL.md` (one current, carriers, no idle wobble).

## Plan (always the director agent)

1. Slug `compositor/runs/<date>-promo-<product>`; init the trace.
2. Delegate to `compositor:director` ("plan" mode): message, 4–7 scenes (title, claim, feature, capture, stat, quote, end), narration per scene (verb-first, ≤ 12 words, STE), captions mirror the narration word for word (mute-mode rule), targets (`landscape` + `reels` by default), voice (`ef_dora` for Spanish, `af_heart` for English, speed 0.9–0.95: 1.0 measured 173 wpm, above the 140–165 range).
3. Write `R/script.json` `{ language, voice, scenes: [{ id, kind, headline, body?, image?, narration, caption }] }`. Confirm once unless `--yes`.

## Audio → plan → build → proof → gate → deliver

```
node P/scripts/promo/voiceover.mjs --script R/script.json --out R/project/_shared/assets --voice <v> --lang <en-us|es> --speed 0.92 --transcribe [--caption-only]
node P/scripts/promo/plan.mjs --script R/script.json --run R
node P/scripts/render/build.mjs --run R --template promo/landscape --params R/params.json --brand compositor/brand.json --targets landscape,yt-landscape
node P/scripts/render/build.mjs --run R --template promo/vertical  --params R/params.json --brand compositor/brand.json --targets reels
```
The vertical template reuses the landscape HTML with in-feed type sizes. Deliver every built target before the dist gate (`probe.missing` fails on a built but undelivered target). Then proof (`--at` one time per scene boundary), read the sheet (type at in-feed scale on vertical, captions in the bottom band, seams cut mid-motion), gate at proof (`check`, `palette`, `seams` when `ledger.json` exists), deliver, gate at dist (`probe`, `loudness` −14 LUFS). After delivery, transcribe one mp4 (`npx hyperframes transcribe <mp4> -d R/dist/check -e auto -l <lang> --json`) and compare with the narration: report word accuracy; under 95% means the voice or the lexicon needs a fix, not the video.

## Report

README table, the sheet, gate table, word accuracy, and the one change that would raise it most (usually a real product capture scene).
