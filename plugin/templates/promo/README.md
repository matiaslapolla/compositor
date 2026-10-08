# promo templates

Narrated or captioned marketing films for social. Two templates share one composition (`landscape/template.html`; `vertical/template.json` points at it with `"html"`):

| Template | Targets | Type sizes |
|---|---|---|
| `promo/landscape` | `yt-landscape`, `linkedin-video`, `x-video`, `landscape` | against the height (hero 12%, headline 8.5%, body 4.2%, captions 4.6%) |
| `promo/vertical` | `reels`, `tiktok`, `shorts`, `stories` | in-feed, against the width (hero 11.2%, headline 9.4%, body 5%, captions 5%) |

What the composition does:
- One root-level clip per scene (`#scene-N`, `data-start`/`data-duration` from the timeline). Its `#stage-N` wrapper carries the seam: cut-the-curve along the current (LEFT), exit `power3.in` 0.34 s to −12%, entry `power4.out` 0.42 s from +10% at 0.35 opacity, no crossfade.
- Staged reveals inside each scene land on the first spoken word of their text (caption word times); unspoken items follow in order. The stat counts up with its meter, then holds 0.4 s before the label. `*word*` in a headline is the accent highlight; it wipes in when the word is spoken.
- The first scene opens with a waterfall entry; the brand chip (mark + name) persists top-left and leaves with the seam into the end scene. Every reveal finishes 1.5 s before the end: the end card holds static.
- Captions: one timed cue per entry in the bottom band of the safe box, two plain lines; `captionStyle: "karaoke"` lifts each word as it is spoken.
- Dark canvas, grain, one accent (the highlight, the meter, the CTA pill); no gradients. `<audio id="vo">` is for preview only; deliver.mjs muxes `plan.audio.mix`.

## Flow

```bash
P=<plugin>; RUN=compositor/runs/<slug>; A=$RUN/project/_shared/assets
node $P/scripts/promo/voiceover.mjs --script $RUN/script.json --out $A --voice ef_dora --speed 0.92 --transcribe   # 1 voice, timeline, captions
node $P/scripts/promo/plan.mjs --script $RUN/script.json --run $RUN                                               # 2 params.json + plan.json
node $P/scripts/render/build.mjs --run $RUN --template promo/landscape --targets landscape                         # 3 build (repeat per template)
node $P/scripts/render/build.mjs --run $RUN --template promo/vertical --targets reels
node $P/scripts/render/proof.mjs --run $RUN --at 0.25,3,6,10,14,19                                                  # read proof/sheet.png
node $P/scripts/gates/gate.mjs --run $RUN --stage proof --mode promo
node $P/scripts/render/deliver.mjs --run $RUN
node $P/scripts/gates/gate.mjs --run $RUN --stage dist --mode promo
```

1. `voiceover.mjs` synthesizes each scene with Kokoro (cached by text hash in `vo/cache/`), times the scenes (first voice at 0.3 s, ≥ 0.4 s between voices, the cut 0.2 s before the next voice, 1.0 s tail), mixes `vo/mix.wav` at −14 LUFS and writes `timeline.json` and `captions.{json,srt,vtt}` (≤ 32 chars × 2 lines, one cue set for every target). `--transcribe` times the captions from the mix's real word timestamps while keeping the script's words. `--caption-only` skips the voice and holds each scene `max(2.5 s, chars / 15)`. It prints the measured WPM and warns outside 140–165 (slow Kokoro with `--speed 0.9`).
2. `plan.mjs` validates the script, copies scene images into `assets/`, writes `params.json` (scenes with their timing, timeline, caption cues, seam ledger) and merges `plan.json`: `mode: promo`, `audio` (mix, captions, SRT/VTT sidecars, language), `copy.headline` (first claim), `copy.cta` (end label), `scenes` (route, carrier).
3. `build.mjs` writes `project/<target>/index.html` and the seam ledger `ledger.json` beside it; `gates/seams.mjs` verifies every seam (axis, direction, mid-motion, zero overlap) on its own preview server.

## script.json

```json
{
  "title": "Acme: promo 20 s (es)",
  "language": "es",
  "voice": "ef_dora",
  "scenes": [
    { "id": "title", "kind": "title", "headline": "¿La IA *recomienda* tu negocio?", "narration": "¿La inteligencia artificial recomienda tu negocio?" },
    { "id": "claim", "kind": "claim", "headline": "Estar primero en Google ya no *alcanza*.", "narration": "Estar primero en Google ya no alcanza." },
    { "id": "feature", "kind": "feature", "headline": "Medimos si la IA te *nombra*.", "body": "Y te damos arreglos listos para pegar.", "items": ["Títulos y descripciones", "Preguntas frecuentes", "JSON-LD y llms.txt"], "narration": "Medimos si la IA te nombra, y te damos arreglos listos para pegar." },
    { "id": "stat", "kind": "stat", "stat": "88%", "label": "de los negocios que revisamos no aparece.", "body": "Medición propia de Acme, octubre de 2026.", "narration": "El 88% de los negocios que revisamos no aparece." },
    { "id": "end", "kind": "end", "headline": "Diagnóstico gratis.", "label": "example.com", "body": "Sin registrarte.", "narration": "Pedí tu diagnóstico gratis, sin registrarte." }
  ]
}
```

Scene fields: `id`, `kind` (`title | claim | feature | capture | stat | quote | end`), `narration` (spoken and captioned), `caption?` (caption-only text), `holdS?` (extra seconds after the voice), and content: `headline` (required except stat/capture), `body`, `label` (kicker, quote attribution, stat label, end CTA pill), `stat` (`"88%"`, `"-58%"`, `"3×"`; a percentage gets a meter), `image` (path relative to the script; required for capture), `items` (≤ 4, feature list). One claim per scene: a headline of ≤ 7 words, a narration of one sentence.

## params.json (written by plan.mjs)

`{ language, duration, scenes: [{ id, kind, headline?, body?, image?, stat?, label?, items?, start, end, voStart, voDuration }], timeline, captions: [{ start, end, lines, words }], captionStyle: "plain" | "karaoke", voSrc: "assets/vo/mix.wav" | null, ledger: { fps, seams } }`.
