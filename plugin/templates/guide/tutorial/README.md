# guide/tutorial

The in-app tutorial overlay: device frame, plates swapped at each click, oversized cursor on its path, click ripple, zoom groups with intent, step chips, captions in the bottom band, 1.5 s title and end cards, voice-over mix shifted by the intro. Params come from `scripts/guide/plan.mjs` (flow in `templates/guide/README.md`). Targets: landscape, yt-landscape, reels (bbox crop).

## Example `params.json`

```json
{
  "title": "Rename a project",
  "steps": [
    { "id": "open-menu", "index": 0, "action": "click", "start": 2.0, "end": 5.2, "clickAt": 2.5, "zoomIn": 2.2, "zoomOut": 4.5, "travel": 0.5, "zoom": 2, "zoomGroup": 1,
      "path": [[720, 450], [640, 300]], "bbox": { "x": 600, "y": 280, "w": 80, "h": 40 }, "center": [640, 300],
      "plate": "assets/captures/step-01.png", "afterPlate": "assets/captures/step-01-after.png",
      "caption": "Open the Projects menu", "narration": "Click Projects to open the project menu." }
  ],
  "viewport": { "width": 1440, "height": 900 },
  "scale": 2,
  "captions": [ { "start": 2.0, "end": 4.8, "lines": ["Click Projects to open", "the project menu."] } ],
  "duration": 8.2,
  "captionOnly": false,
  "spotlight": false,
  "intro": 1.5,
  "outro": 1.5,
  "endAt": 6.7,
  "audio": "assets/vo/guide-mix.wav"
}
```
