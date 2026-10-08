# guide templates

`guide/tutorial` turns a captured app run into an in-app tutorial video. It shows a device frame (or a vertical crop), the plates, an oversized cursor on the step paths, click ripples, the camera zoom, a step chip, two-line captions, a title card and a static end frame.

Times in `params.json` are seconds on the video clock. The video clock is the narration clock plus `intro` (1.5 s for the title card). The video ends with an `outro` of 1.5 s on the end frame.

## Flow

Run every command from `plugin/`. `R` is the run directory, `compositor/runs/<slug>` next to `compositor/brand.json`.

1. **Capture.** Serve the app, then drive it through `steps.json` (format in `references/guide.md`):
   ```sh
   node scripts/guide/capture-steps.mjs --steps steps.json --dry
   node scripts/guide/capture-steps.mjs --url http://localhost:3000/ --steps steps.json --out $R/captures
   ```
   This writes `$R/captures/step-NN.png`, `step-NN-after.png` and `manifest.json`.
2. **Narration.** Write the voice-over, the timeline and the captions into the shared assets:
   ```sh
   node scripts/guide/narration.mjs --manifest $R/captures/manifest.json --out $R/project/_shared/assets --voice af_heart --speed 0.9
   ```
   This writes `vo/step-NN.wav`, `vo/mix.wav` (−16 LUFS), `timeline.json` and `captions.{json,srt,vtt}`. Keep the measured pace in 140–165 wpm.
3. **Plan.** Merge the manifest and the timeline:
   ```sh
   node scripts/guide/plan.mjs --run $R --manifest $R/captures/manifest.json --timeline $R/project/_shared/assets/timeline.json [--title "…"] [--spotlight]
   ```
   This writes the following files:
   - `$R/params.json`.
   - `$R/plan.json`: it holds `mode: guide`, `steps` (the shape guide-lint reads), `audio` and `guide`.
   - `project/_shared/assets/guide-overlay.js`: the motion engine from `scripts/guide/overlay.mjs`.
   - `guide-captions.{json,srt,vtt}`: cues on the video clock.
   - `vo/guide-mix.wav`: the mix delayed by the intro and padded to the full duration. deliver.mjs muxes this file.
   - `step-NN-blank.png` for each type step: the field with its text removed, so the placeholder vanishes at the first key.

   Each click, hover and press step also gets a `resultBox`. This is the region that changed outside the target, measured from the plates, and the camera pans to it after the click.
4. **Build.**
   ```sh
   node scripts/render/build.mjs --run $R --template guide/tutorial --brand compositor/brand.json --targets landscape --assets $R/captures
   ```
   `--assets` copies the captures to `assets/captures/`, where the plates are referenced.
5. **Proof.** Pick the title, step 1 travel, step 1 click + 0.2, a zoomed step and the end:
   ```sh
   node scripts/render/proof.mjs --run $R --at 0.8,2.23,2.66,6.1,14.2
   ```
   Read `proof/sheet.png`. Check that the cursor tip sits on the target and that no zoom crops the target or its result. Check that the chip and the captions stay off the frame.
6. **Gate.**
   ```sh
   node scripts/gates/gate.mjs --run $R --stage proof --mode guide --brand compositor/brand.json
   ```
   This runs `check`, `palette` and `guide-lint`. For guide mode, palette only warns, because the captured UI is not brand colour.
7. **Deliver.**
   ```sh
   node scripts/render/deliver.mjs --run $R --only landscape
   node scripts/gates/gate.mjs --run $R --stage dist --mode guide
   ```
   This writes `dist/landscape/landscape.{mp4,srt,vtt}`, with the narration at −14 LUFS.

### Caption-only variant

To make a video without a voice-over, run narration with `--caption-only`. It writes no TTS. Each step holds for `max(1.2 s, caption chars / 15)`, and the cues carry `caption`. Then run `plan.mjs` as usual: it detects `timeline.mix: null`, or you can force it with `--caption-only`. The result has these differences:
- `params.captionOnly` is true and `params.audio` is null.
- The template renders no `<audio>`.
- The chip shows only "Step n of N", because the captions already carry the step text.
- `plan.guide.captionOnly` makes guide-lint check the caption hold.

## guide/tutorial

| target | canvas | layout |
|---|---|---|
| `landscape` (default), `yt-landscape` | 1920×1080 | The chip band sits above the frame and ends by about 12% from the top. The device frame is centred, with a 42 px chrome bar, traffic lights, no URL, an 18 px radius and the `0 40px 90px -20px` shadow. Two caption lines sit below the frame and above the bottom safe inset. |
| `reels` | 1080×1920 | The chip is at 12.5% from the top. A full-bleed crop band shows the plate. Captions sit above the 420 px platform inset. The z = 1 crop centres on each step's target and moves during the cursor travel. |

### Motion rules

All rules are pure functions in `scripts/guide/overlay.mjs`, sampled once per frame into GSAP keyframes:

- **Plates.**
  - Click, hover and press swap to `afterPlate` at `clickAt`.
  - Type shows the blank plate at `clickAt`, then reveals `afterPlate` left to right over the typed text, one step per character, for chars × 0.05 s.
  - Navigate, scroll and wait crossfade over 0.25 s.
- **Cursor.**
  - The arrow is 4.6% of the short side (about 50 px at 1080p), with its tip on the target.
  - It enters from below the frame in the 0.5 s before step 1 (`power3.out`).
  - It rides each `path` from `start` to `clickAt` (`power2.inOut`).
  - It presses on its tip at each click (0.84 for 0.1 s, back over 0.22 s).
  - It leaves through the bottom edge after the last step (`power2.in`).
- **Ripple.** The ripple runs at `clickAt` for click and type: 0.4 s, 0 → 48 px, a 2 px accent stroke with a 1 px light halo.
- **Camera.**
  - Each zoom group zooms in once at the first `zoomIn` (0.7 s, `power3.out`) and zooms out once at the last `zoomOut` (0.7 s).
  - The zoom is the group's largest zoom. It is capped at 2.5×, at 1.25× upsampling of the plate, and at the size where every target and result box of the group still fits.
  - Zoom in and zoom out are each a zoom about one fixed point, so the window never leaves the viewport.
  - Inside a group, a new target pans the camera (from `clickAt − 0.3`, over 0.6 s) only when its centre leaves the 15% dead zone or its box is cut.
  - A result outside the frame pans the camera after the ripple.
- **Spotlight.** It is off by default; turn it on with `--spotlight` in plan.mjs. It dims to 45% with a 10 px padded, 14 px radius cutout, fades over 0.25 s, and shows one cutout at a time.
- **Chip and captions.** The chip enters from the right at each step start. Captions cut in and out on the cue times. Nothing moves while the voice speaks.

### params.json

```json
{
  "title": "Rename a project",
  "steps": [{
    "id": "open-menu", "index": 1, "action": "click",
    "start": 2, "end": 5.053, "clickAt": 2.464, "zoomIn": 2.164, "zoomOut": 4.353, "travel": 0.464,
    "zoom": 2, "zoomGroup": 1,
    "path": [[720, 450], "… 32 points …", [1369.91, 34.25]],
    "bbox": { "x": 1327.81, "y": 14, "w": 84.19, "h": 40.5 }, "center": [1369.91, 34.25],
    "plate": "assets/captures/step-01.png", "afterPlate": "assets/captures/step-01-after.png",
    "caption": "Open the Projects menu", "narration": "Click Projects to open the project menu.",
    "resultBox": null
  }, {
    "id": "type-name", "action": "type", "…": "…",
    "typed": { "text": "Launch plan", "chars": 11, "reveal": [401, 485] },
    "blankPlate": "assets/captures/step-03-blank.png"
  }],
  "viewport": { "width": 1440, "height": 900 },
  "scale": 2,
  "captions": [{ "start": 2, "end": 4.453, "lines": ["Click Projects to open the project menu."], "words": [] }],
  "duration": 14.803,
  "captionOnly": false,
  "spotlight": false,
  "intro": 1.5, "outro": 1.5, "endAt": 13.303,
  "audio": "assets/vo/guide-mix.wav"
}
```
