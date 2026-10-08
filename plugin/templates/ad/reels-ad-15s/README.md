# ad/reels-ad-15s

A vertical 15 s ad, authored for the full 9:16 frame: hook, two or three value beats, a proof line and a static end card. Every claim is on screen, so the ad works muted. Captions are optional.

- Kind: motion, 15 s at 30 fps. Targets: `reels-ad`, `stories-ad`, `tiktok-ad`, `shorts-ad` (each with its own ad safe box; `reels-ad` keeps the top 14% and the bottom 35% clear).
- Schedule (D = 15):
  - Hook: 0 to 2.6 s. On screen from frame 0, settles up, then one slow push, then leaves upward.
  - Beats: 2.6 to 10.6 s, in equal parts. Each text is uncovered by a clip. The first capture rises in a card that runs off the right and bottom frame edges; later captures wipe in from the right over the previous one; each pushes 6% while its beat lasts.
  - Proof: 10.6 to 12.4 s. Without `proof`, the beats take this time.
  - Close: a right-to-left wipe from 12.4 s, then the end card is static from 12.95 s to 15 s.
- Text sizes are fitted after fonts load: hook 9 to 13.5% of the width, ≤ 4 lines; beats ≥ 8% of the width (≥ 4.5% of the height), ≤ 3 lines.
- Captions: `captions` cues render on one plate at the bottom of the safe box. The plate is up from the first cue to the last, so only its text changes (a plate per cue over a light capture would flash). Cues cut at the cue edges and are clipped at the close, so the end card stays still. Keep cues ≤ 2 lines of ≤ 32 characters. Also set `audio.captions` in the params (a file under the run) if `ad-lint` should check the line lengths.
- No flashing: the scenes share one canvas, and captures enter and leave once. On a delivered `reels-ad` render: first change 0.033 s, at most 1 opposing luminance change per second, last 2 s static.

## Params

| param | type | rule | notes |
|---|---|---|---|
| `headline` | string | required, ≤ 7 words | the hook (`plan.copy.headline`) |
| `beats` | array | required, 2 to 3 | `[{ text, image?, zoom?, focus? }]`, text ≤ 10 words |
| `proof` | string | ≤ 10 words | optional proof line |
| `cta` | string | required, ≤ 4 words | end card pill |
| `url` | string | ≤ 32 chars | optional |
| `legal` | string | ≤ 140 chars | optional |
| `captions` | array | optional | `[{ start, end, text }]` in seconds |
| `imageFocus` | string | default `0% 0%` | crop anchor for every capture |
| `imageZoom` | number | default `1.3` | crop zoom; a beat's `zoom` overrides it (use 1 for a capture with large type of its own) |

## Example `params.json`

```json
{
  "headline": "¿La IA recomienda a tu competencia?",
  "beats": [
    { "text": "Preguntamos a ChatGPT y Gemini por tu rubro", "image": "assets/landing.png", "zoom": 1 },
    { "text": "Ves si te nombran, y a quién eligen", "image": "assets/report.png" },
    { "text": "Y qué cambiar para que te elijan", "image": "assets/fixes.png" }
  ],
  "proof": "Te nombraron en 7 de cada 10 respuestas",
  "cta": "Revisá gratis",
  "url": "example.com",
  "captions": [
    { "start": 0.2, "end": 2.4, "text": "¿La IA recomienda a tu competencia?" },
    { "start": 2.7, "end": 5.2, "text": "Preguntamos a ChatGPT y Gemini por tu rubro." }
  ]
}
```
