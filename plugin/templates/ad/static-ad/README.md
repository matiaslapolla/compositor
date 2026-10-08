# ad/static-ad

One-message static ad for display and feed slots. One focal element: the headline, or a product capture under it. The CTA pill is the only accent (the 10%). The brand mark sits in the top-left corner at 5% of the width (the brand name when there is no mark).

- Kind: still. Targets: `gda-landscape`, `gda-square`, `gda-portrait`, `ig-feed`, `ig-square`, `linkedin-image`, `x-image`.
- Layout reflows by orientation: portrait and square stack logo, copy, CTA and capture; landscape puts the copy left and the capture right. A capture starts inside the safe box and runs off the right and bottom frame edges, so the crop happens at the frame edge.
- After fonts load, the headline takes the largest size that keeps it to 2 lines (3 above four words) inside 86% of its column, the copy (headline, subline, URL, CTA pill) under 20% of the frame, and a portrait capture at least 30% of the frame tall. The measured share is written to `<html data-text-share>`.
- Hierarchy in grayscale: headline > capture > CTA. On a dark canvas a light capture is the brightest block, so the headline is sized up when a capture is present.

## Params

| param | type | rule | notes |
|---|---|---|---|
| `headline` | string | required, ≤ 7 words | 2 to 5 words is best |
| `subline` | string | ≤ 14 words | optional |
| `cta` | string | required, ≤ 4 words | accent pill |
| `image` | string | path under `assets/` | pass the file with `build.mjs --assets`; optional |
| `imageFocus` | string | default `0% 0%` | CSS object-position of the crop |
| `imageZoom` | number | default `1.3` | crop zoom in portrait and square (`object-view-box`, the image box never grows); landscape ignores it |
| `url` | string | ≤ 32 chars | optional, beside the CTA |

## Example `params.json`

```json
{
  "headline": "¿Te recomienda ChatGPT?",
  "subline": "Revisamos qué responden las IA cuando un cliente pregunta por tu rubro.",
  "cta": "Revisá gratis",
  "image": "assets/report.png",
  "url": "example.com"
}
```

```bash
node scripts/render/build.mjs --run <run> --template ad/static-ad --params <run>/params.json --brand compositor/brand.json --assets path/to/report.png
node scripts/render/proof.mjs --run <run>
node scripts/gates/gate.mjs --run <run> --stage proof --mode ad
```
