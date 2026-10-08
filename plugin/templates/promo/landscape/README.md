# promo/landscape

The promo film at 16:9: timed scenes (title, claim, feature, capture, stat, quote, end) cut along one direction, captions from the voice-over cues, persistent brand chip, static end. Params come from `scripts/promo/plan.mjs` (see `templates/promo/README.md` for the full flow); `promo/vertical` reuses this HTML.

## Example `params.json`

```json
{
  "scenes": [
    { "id": "title", "kind": "title", "headline": "¿La IA *recomienda* tu negocio?", "start": 0, "end": 3.4, "voStart": 0.3, "voDuration": 2.9 },
    { "id": "claim", "kind": "claim", "headline": "Estar primero en Google ya no *alcanza*.", "start": 3.4, "end": 6.3, "voStart": 3.6, "voDuration": 2.5 },
    { "id": "end", "kind": "end", "headline": "Diagnóstico gratis.", "body": "Sin registrarte.", "start": 6.3, "end": 9.5, "voStart": 6.5, "voDuration": 2.8 }
  ],
  "timeline": { "fps": 30, "duration": 9.5, "scenes": [] },
  "captions": [ { "start": 0.3, "end": 3.2, "lines": ["¿La inteligencia artificial", "recomienda tu negocio?"], "words": [] } ],
  "duration": 9.5,
  "captionStyle": "plain",
  "voSrc": "assets/vo/mix.wav",
  "language": "es"
}
```
