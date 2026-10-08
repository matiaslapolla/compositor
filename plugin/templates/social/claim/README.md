# social/claim

One claim, the brand mark, one accent rule. `kind: both`: stills for feed and link images, a 6 s seamless loop for square and vertical video. Targets: ig-feed, ig-square, x-image, linkedin-image, reels (any sized target works).

Params: `headline` (≤ 7 words, required), `subline` (≤ 16), `kicker` (≤ 4), `cta` (≤ 4, pill), `accent` (`rule` | `block` | `none`), `align` (`start` | `center`).

## Example `params.json`

```json
{
  "headline": "Agents that stop where you decided.",
  "subline": "Every action on the record, every stop yours.",
  "kicker": "Orbit",
  "cta": "Start free",
  "accent": "rule",
  "align": "start"
}
```

Loop check: `proof.mjs --at 0,5.97` frames must both be empty of content.
