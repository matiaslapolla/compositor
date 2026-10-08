# Director rubric

The director rates proof frames and plans on six axes, 1–5 each, with one sentence of evidence per axis. Ratings go into `run.json` and never change a gate's exit code (ADR 0002). After 20 rated runs, agreement with the user's verdicts is measured.

| Axis | 5 looks like | 1 looks like |
|---|---|---|
| Message | One claim per frame, readable in a second, true to the brief | Several ideas, vague copy, a claim the brief did not make |
| Brand | Palette, type and voice are the product's; the asset could only be this brand | Generic colours, reflex fonts, a layout any AI would make |
| Composition | Fills the frame, anchored to edges, one focal point, type at video scale | Floating centred stack, dead space, web-sized text |
| Motion | Performs: entrances land on beats, seams carry the eye, stillness before the climax | Wobble, crossfades, bounce, everything from the same y:30 fade |
| Craft | Optical centring, consistent stroke and radius, legible at the smallest target | Misalignment, inconsistent radii, text that will not survive 1080p compression |
| Restraint | Every element earns its place; nothing decorative without meaning | Sparkles, glows, gradient text, three accents, a showreel |

## Prohibited directions (web-design, hard bans)
Borrowed document, showreel (neon on near-black, magnetic buttons, sticky stacks, word-by-word reveals, looping pulses), Swiss poster as ornament, fake control room. Name the discipline being imitated; if the product is not that discipline, the direction is dead.

## Slop tells (reject on sight)
Indigo/violet accent by default, gradient text, glowing coloured shadows, radial haze, Inter/Roboto/Space Grotesk/Instrument Serif by reflex, bounce or elastic eases, identical fade-in-up on every element, pulsing dots, pure #000/#FFF, sparkles, three ideas in one mark, nodes-and-lines brains.

## Output format (findings.md)
```
# Findings: <slug>

Rating: message 4 · brand 5 · composition 3 · motion 4 · craft 4 · restraint 5 → 4.2

## Keep
- <what works, one line each>

## Fix (ordered by impact)
1. <finding> — <evidence: target, frame time, element> — <the one change>
2. …

## Would raise the bar most
<one sentence>
```
And a JSON block at the end: `{"rating": {"message": 4, "brand": 5, "composition": 3, "motion": 4, "craft": 4, "restraint": 5, "mean": 4.2}, "fixes": [{"target": "reels", "t": 1.2, "element": "#headline", "change": "…"}]}`.
