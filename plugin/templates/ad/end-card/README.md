# ad/end-card

The static close of an ad or a promo: the brand lockup (mark beside the name), an optional offer line, the CTA pill, an optional URL and an optional legal line.

- Kind: motion, 2.5 s at 30 fps, `loop: hold`. Targets: `yt-landscape`, `reels-ad`, `ig-square`, `landscape`.
- Frame 0 already shows the whole card. The lockup, the offer and the CTA settle from the right (the brand current) on staggered offsets in 0.5 s, translation only: no frame shows the CTA at reduced contrast. From 0.5 s the card is still to the end.
- The stack centres in the target's safe box, so in vertical ads it sits above the platform band.
- Alone it is not an ad: `ad-lint` warns `ad.duration` (2.5 s is under the 6 s floor). Use it as the last shot of a longer piece, or render it with `--duration` to hold longer.

## Params

| param | type | rule | notes |
|---|---|---|---|
| `cta` | string | required, ≤ 4 words | accent pill |
| `headline` | string | ≤ 7 words | optional offer line |
| `url` | string | ≤ 32 chars | optional |
| `legal` | string | ≤ 140 chars | optional, small and muted at the bottom of the safe box |
| `logo` | enum | `lockup` (default) or `name` | `name` drops the mark |

## Example `params.json`

```json
{
  "cta": "Revisá gratis",
  "headline": "Sabé qué dicen las IA de vos",
  "url": "example.com",
  "legal": "Revisión gratuita de hasta 10 consultas."
}
```
