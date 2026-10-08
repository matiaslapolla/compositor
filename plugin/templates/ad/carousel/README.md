# ad/carousel

A swipe carousel: hook, context, proof, ask. One composition per slide (`instances: "slides"`), all at the target's ratio, bound into a PDF by `deliver.mjs` for document posts.

- Kind: page. Targets: `ig-feed`, `linkedin-portrait`, `linkedin-document` (all 1080×1350).
- Every slide keeps its content in the centre 80% (10% insets, wider than any of these platform insets). Every slide shows the brand mark top-left and a number chip (`3 / 6`) top-right.
- Slide 1 is the hook: the largest headline (≤ 4 lines), an optional body, and the swipe cue bottom-right. It never carries a capture.
- Middle slides: an optional kicker, the headline, an optional body, and an optional capture that starts in the safe area and runs off the slide's right and bottom edges, so it reads as continuing into the next slide. Without a capture the copy centres.
- The last slide is only the ask: the brand lockup, the slide's headline as the ask, the CTA pill (the only accent in the set) and the URL. Its body and image are ignored.
- `plan.copy.headline` is slide 1's headline (`ad-lint` holds it to ≤ 7 words); `plan.copy.cta` is `cta`.
- Use the kicker sparingly: a label above every headline is an eyebrow by reflex.
- Any top-level param can be overridden per slide (for example `imageZoom: 1` on a slide whose capture has large type of its own).

## Params

| param | type | rule | notes |
|---|---|---|---|
| `slides` | array | required, 5 to 7 | `[{ kicker?, headline, body?, image? }]` |
| `cta` | string | required, ≤ 4 words | last slide |
| `url` | string | ≤ 32 chars | optional, last slide |
| `swipeLabel` | string | default `Swipe`, ≤ 2 words | the cue on slide 1, in the ad's language |
| `imageFocus` | string | default `0% 0%` | crop anchor |
| `imageZoom` | number | default `1.3` | crop zoom |

## Example `params.json`

```json
{
  "slides": [
    { "headline": "Tus clientes ya le preguntan a ChatGPT", "body": "¿Qué les responde cuando buscan tu rubro?" },
    { "headline": "Antes buscaban en Google. Ahora preguntan.", "body": "ChatGPT y Gemini responden con dos o tres nombres." },
    { "headline": "Hacemos las preguntas que haría tu cliente", "body": "Diez consultas reales de tu rubro, en tu ciudad.", "image": "assets/report.png" },
    { "headline": "Ves quién te nombra y a quién elige", "image": "assets/landing.png", "imageZoom": 1 },
    { "headline": "Arreglos concretos, listos para copiar", "image": "assets/fixes.png" },
    { "headline": "Revisá qué dicen las IA de tu negocio" }
  ],
  "cta": "Revisá gratis",
  "url": "example.com",
  "swipeLabel": "Deslizá"
}
```

```bash
node scripts/render/build.mjs --run <run> --template ad/carousel --params <run>/params.json --brand compositor/brand.json --targets linkedin-document --assets a.png,b.png
node scripts/render/deliver.mjs --run <run>   # dist/linkedin-document/linkedin-document.pdf
```
