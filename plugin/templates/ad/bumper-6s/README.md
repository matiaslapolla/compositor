# ad/bumper-6s

A six-second bumper: one visual idea, then the close. Never a cutdown of a longer ad.

- Kind: motion, 6 s at 30 fps. Targets: `yt-landscape`, `reels-ad`, `ig-square`.
- Schedule:
  - 0.0 s: frame 0 already holds the corner mark and the capture (or, without a capture, the shot opens on the headline).
  - 0.0 to 0.7 s: the capture settles up; the headline is uncovered from 0.15 s by a clip, no fade. The first visible change is on frame 1.
  - 0.7 to 3.3 s: one slow push into the capture (an `object-view-box` zoom, the only camera move).
  - 3.0 to 3.35 s: the headline leaves upward.
  - 3.35 to 3.95 s: a right-to-left wipe hands over to the end card. One moving edge carries the cut and nothing leaves the frame.
  - 3.95 to 6.0 s: the end card (lockup, CTA, URL, legal) is static.
- `plan.copy.headline` and `plan.copy.cta` come from the params; `ad-lint` warns above 5 words.
- Measured on a delivered `yt-landscape` render: first change 0.033 s, 1 luminance event per second at most, end card static for the last 2 s.

## Params

| param | type | rule | notes |
|---|---|---|---|
| `headline` | string | required, ≤ 5 words | the one idea |
| `cta` | string | required, ≤ 3 words | end card pill |
| `image` | string | path under `assets/` | optional product capture |
| `imageFocus` | string | default `0% 0%` | crop anchor |
| `imageZoom` | number | default `1.25` | crop zoom in portrait and square; the push adds 8% |
| `url` | string | ≤ 32 chars | optional |
| `legal` | string | ≤ 140 chars | optional |

## Example `params.json`

```json
{
  "headline": "¿Te recomienda la IA?",
  "cta": "Revisá gratis",
  "image": "assets/report.png",
  "url": "example.com"
}
```
