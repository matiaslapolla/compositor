# guide mode: capture, narration, timeline

The guide pipeline turns a running app plus a `steps.json` into three files the overlay composition plays against:

1. `node scripts/guide/capture-steps.mjs --url <app url> --steps steps.json --out <run>/project/captures` writes plates and `captures/manifest.json`.
2. `node scripts/guide/narration.mjs --manifest <run>/project/captures/manifest.json --out <run>/project/assets` writes `vo/step-NN.wav`, `vo/mix.wav`, `timeline.json` and `captions.{json,srt,vtt}`.
3. The orchestrator writes the composition. It reads the manifest and the timeline. These scripts do not write it.

Run `capture-steps.mjs --steps steps.json --dry` first. It validates the file without a browser and exits 2 on schema errors.

## steps.json

```json
{
  "title": "Rename a project",
  "locale": "en",
  "steps": [
    { "id": "open-menu", "action": "click", "selector": "#menu-button",
      "narration": "Click Projects to open the project menu.", "caption": "Open the Projects menu" },
    { "id": "type-name", "action": "type", "selector": "#project-name", "text": "Launch plan",
      "narration": "Type the new name, Launch plan.", "caption": "Type the new name", "zoom": "auto", "holdMs": 1500 }
  ]
}
```

| action | required | what happens |
|---|---|---|
| `navigate` | `url` (absolute, or relative to the current page) | Goes to the URL and waits for network idle. The cursor does not move. |
| `click` | `selector` | Waits until the element is visible, scrolls it into view, clicks its centre. |
| `hover` | `selector` | Same as click, but hovers. |
| `type` | `selector`, `text` | Clicks the field, types the text one key at a time, captures one plate at the end. |
| `press` | `key` (Puppeteer key name, such as `Enter`), optional `selector` | Focuses the selector if given, presses the key. The cursor does not move. |
| `scroll` | `selector` | Scrolls the element to the centre of the viewport. The bbox is measured after the scroll. |
| `wait` | `selector` | Takes the before plate, then waits until the element is visible. |

Every step needs a unique `id`, a `narration` and a `caption`. Optional fields:

- `zoom`: a number from 1 to 2.5 (higher values are capped), or `"auto"`. When it is omitted, click, hover, type and press with a selector zoom automatically. The other actions stay at 1×.
- `holdMs`: the minimum time the result stays on screen after the action. The floor is 1.2 s.
- `waitFor`: a selector that must be visible before the after plate is taken. Use it when the action lands on a page that streams in behind a loading skeleton.

`--color-scheme light|dark` emulates `prefers-color-scheme`. Without it the headless browser inherits the desktop's scheme.

One file per locale (research rule 15). Capture each locale against the app's own locale URL or flag. `--locale` (or the file's `locale`) sets `--lang`, `Accept-Language` and `navigator.language`.

## Writing narration and captions

- Start with the verb, in the imperative: "Click Save", "Choose Rename", "Abrí el menú". `gates/guide-lint.mjs` warns when the first word is not a known imperative.
- Use 12 words or fewer per sentence, and one sentence for each action. A second short sentence can state the result.
- Quote the exact UI label, with the same case as on screen.
- Say what the viewer will see: "The name field becomes editable."
- Plan for about 2.5 words per second of step. More words make the step longer, not faster.
- `caption` is the short on-screen label (2 lines × 42 chars at most). The sidecar subtitles carry the narration words, so narration and subtitles always match (research rule 14). In `--caption-only` mode the captions carry `caption`.

## Voices (Kokoro, local)

| locale | voice | `--lang` |
|---|---|---|
| en (default) | `af_heart` (alternative `af_bella`) | `en-us` |
| en-GB | `bf_emma` | `en-gb` |
| es | `ef_dora` | `es` |

The voice is picked from `manifest.locale`. `--voice`, `--lang` and `--speed` override it. Use speed 1.0 for tutorials and 1.05–1.1 for demos. Measured pace must be 140–165 wpm, and `narration.mjs` warns outside that range. `af_heart` at speed 1 measured 174 wpm on short tutorial sentences. `--speed 0.9` brought the same text to 162 wpm.

Clips are cached in `vo/cache/<sha1(text, voice, speed, lang)>.wav`. A rerun synthesizes only steps whose text or voice changed. A cached rerun takes under 1 s.

## Capture details

- The viewport is 1440×900 at deviceScaleFactor 2 by default, so each plate is a 2880×1800 PNG of the viewport only.
- Before every plate the capture does these things:
  - It injects `*{animation:none;transition:none;caret-color:transparent;cursor:none}` and hides scrollbars.
  - It emulates `prefers-reduced-motion: reduce`.
  - It waits for network idle (250 ms with no requests), `document.fonts.ready`, image loads, and two animation frames.
- There are no fixed sleeps. `--timeout` (default 30000 ms) bounds each wait.
- `animation:none` shows each element at its base style. An element that only becomes visible through `animation-fill-mode: forwards` stays hidden. Give it a visible base style in the app, or hide it with `--hide`.
- `--hide sel1,sel2` sets `visibility:hidden` on cookie banners, chat widgets and similar elements. Layout does not move.
- `changesUi` is measured. It is true when more than 0.02% of the pixels differ by more than 16 levels between the before and after plates. It is always true for `navigate`.
- Errors name the step, the action and the selector, for example: `step 2 "ghost" (click "#does-not-exist"): matched nothing within 1500 ms`.

## manifest.json

```json
{
  "title": "Rename a project",
  "viewport": { "width": 1440, "height": 900 },
  "scale": 2,
  "locale": "en",
  "url": "http://127.0.0.1:44439/",
  "steps": [{
    "id": "open-menu", "index": 0, "action": "click", "selector": "#menu-button",
    "narration": "…", "caption": "…",
    "plate": "step-01.png", "afterPlate": "step-01-after.png",
    "bbox": { "x": 1327.81, "y": 14, "w": 84.19, "h": 40.5 },
    "center": [1369.91, 34.25],
    "path": [[720, 450], "… 32 points …", [1369.91, 34.25]],
    "zoom": 2, "zoomGroup": 1,
    "typed": { "text": "Launch plan", "chars": 11 },
    "holdMs": 1500,
    "changesUi": true
  }]
}
```

- All coordinates are CSS px in viewport space, measured after scrolling the target into view. To get plate pixels, multiply by `scale`.
- `bbox` is null for `navigate` and for `press` without a selector.
- `center` is the bbox centre, or the cursor position when there is no bbox.
- `path` always has 32 points. It runs from the previous cursor position to this step's cursor position. For step 1 it starts at the viewport centre.
  - It is a cubic Bézier. The control points sit at 1/3 and 2/3 of the chord. They are pushed 12% of the distance to the left on even indexes and to the right on odd ones.
  - The cursor travels only for click, hover and type. For other actions all 32 points are the same.
  - The cursor stays put in screen space when the page scrolls.
- Zoom rules:
  - The default is 1.5×. When the larger side of the target is below 120 CSS px, the zoom is 2×. `"auto"` applies the same rule to any action that has a bbox. The cap is 2.5×.
  - In the manifest, `zoomGroup` comes from a planned timeline that assumes 150 wpm. `timeline.json` recomputes it from the real VO durations, and that value is the authoritative one.
- `typed` and `holdMs` appear only when they apply.

## timeline.json

```json
{
  "fps": 30,
  "duration": 11.364,
  "steps": [{
    "id": "open-menu", "start": 0.5, "end": 3.425,
    "travel": 0.464, "clickAt": 0.964,
    "zoomIn": 0.664, "zoomOut": 2.725, "zoom": 2, "zoomGroup": 1,
    "vo": "vo/step-01.wav", "voStart": 0.5, "voDuration": 2.325,
    "caption": "Open the Projects menu"
  }],
  "mix": "vo/mix.wav",
  "captions": "captions.json",
  "voice": { "voice": "af_heart", "speed": 1, "lang": "en-us" },
  "wpm": { "overall": 174, "inRange": false, "steps": [{ "id": "open-menu", "words": 7, "seconds": 2.325, "wpm": 181 }], "outliers": ["open-menu"] }
}
```

All times are seconds from 0, rounded to ms. The pure function `buildTimeline(manifest, durations)` in `narration.mjs` applies these rules:

| quantity | rule |
|---|---|
| `start` | Previous `end` plus 0.5 s. When the previous step changed the UI, the pause is 0.8 s. Step 1 starts at 0.5 s. |
| `travel` | 0 when the cursor does not move. Otherwise 0.35 + 0.25 × min(1, distance / viewport diagonal), so 0.35–0.6 s. |
| `clickAt` | `start + travel`: the moment the action lands (click, first key, hover). |
| `end` | The larger of `start + max(voDuration + 0.6, 2)` and `clickAt + hold + 0.7` (0.7 s only when zoomed). `hold = max(1.2, holdMs/1000)`. |
| `zoomIn` | `clickAt − 0.3`. It is null when `zoom` is 1. |
| `zoomOut` | `end − 0.7`, which is always at least `clickAt + hold`. |
| `zoomGroup` | Consecutive zoomed steps share a group when the next `zoomIn` is less than 1.5 s after the previous `zoomOut + 0.7`. Non-zoomed steps get null. |
| `voStart` | Equals `start`. Narration begins while the cursor moves. |
| `duration` | Last `end` + 0.5 s. |

- `--caption-only` skips TTS. It sets `voDuration = max(1.2, caption chars / 15)` and `vo`, `mix`, `voice` and `wpm` are null.
- `vo/mix.wav` is 48 kHz mono PCM, exactly `duration` long. Each clip is placed at `voStart` with `adelay`, the clips are summed with `amix normalize=0`, and the result is loudnormed in two passes to −16 LUFS / −1.5 dBTP. The orchestrator mixes music under it to −14 LUFS for delivery.
- Captions come from the narration spread over each VO span by character weight. Cues have at most 2 lines of 42 chars and 20 chars/s, and hold 0.83–7 s.
- `--transcribe` builds the captions from local whisper word timestamps of the mix instead. It took about 18 s for 11 s of audio.
- `planSteps(manifest, timeline)` returns `plan.json` `steps` in the shape `gates/guide-lint.mjs` reads: `{ index, id, start, duration, actionAt, zoom, zoomGroup, narration, caption, captionDuration }`.

## What the overlay composition does with these files

- **Background plate.** Show `plate` from `start` to `clickAt`, then `afterPlate`.
  - For `type`, reveal `afterPlate` across the typing span, from `clickAt` to about `clickAt + typed.chars × 0.05`, for example with a left-to-right mask over `bbox`.
  - For `wait`, `scroll` and `navigate`, crossfade at `clickAt`. That is `start` for these actions, because `travel` is 0.
- **Cursor.** Draw a cursor overlay at 1.5–2× size with a soft shadow. Move it along `path` from `start` to `clickAt` with `power2.inOut`. Show a click ripple at `clickAt`: 0.4 s, 0 → 48 px, 2 px accent stroke.
- **Camera.** Scale by `zoom` around `center`.
  - Zoom in from `zoomIn` with `power3.out` over 0.6–0.9 s. Zoom out from `zoomOut` over 0.7 s.
  - Inside one `zoomGroup`, zoom in once at the first step's `zoomIn` and zoom out once at the last step's `zoomOut`. Between them, pan to each new `center` from that step's `clickAt − 0.3`, with a 15% dead zone. Use the group's largest zoom.
  - Never exceed 2.5× on a 2× plate.
- **Spotlight (optional).** Dim to 40–55% with a rounded cutout around `bbox` (r 12–16, padding 8–12), fading over 0.25 s. Show one at a time.
- **Captions and chips.** Render `captions.json` cues `{ start, end, lines, words }` in the bottom safe band, outside the device frame. Ship `captions.srt` and `captions.vtt` as sidecars. Put the step chip ("Step n of N") and `caption` in the top-left chip area.
- **Audio.** `vo/mix.wav` starts at t = 0 and runs for the whole composition.
