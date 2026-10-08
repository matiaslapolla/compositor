# Gate rules and fix hints

Each `### <rule>` heading is a stable rule id emitted by `scripts/gates/*.mjs`; the first line under it is the fix hint the gates attach to findings and the verifier quotes. A heading ending in `*` is a prefix fallback. Statuses: `fail` blocks delivery, `warn` is reported, `skip` means the rule could not be measured (the reason says why).

Run: `node scripts/gates/gate.mjs --run <runDir> --stage proof|dist --brand <brand.json> [--mode <mode>] [--only a,b] --json`. Output: `runDir/gates.json` = `{ stage, at, results: [{ gate, status, findings: [{ rule, status, evidence, hint }] }], status }`.

## check (`hyperframes check --strict --frame-check --caption-zone`)

### hf:*
Read the finding's message and selector; hyperframes' own fixHint is attached when it has one. Fix the composition and re-run the proof.

### hf:check_error
hyperframes check could not run the project: open the error, fix the composition so `hyperframes lint` passes, re-run.

### hf:caption_zone_collision
Move the text above the target's bottom safe band (platform UI covers it), or mark intentional lower-third copy with `data-layout-allow-caption-zone`.

### hf:frame_out_of_frame
Keep media inside the composition frame and the target's safe box; shrink or re-anchor the element.

## probe (dist only)

### probe.missing
No media file was delivered for this target: re-run `scripts/render/deliver.mjs` for it.

### probe.target
The target has no preset in `scripts/targets/presets.mjs`: add it there or drop it from `plan.targets`.

### probe.unreadable
ffprobe cannot read the file: the encode failed or was interrupted; re-encode it.

### probe.format
Wrong container for the target kind: stills must be PNG/JPG/WebP, motion must be MP4 (or the target's alpha format).

### probe.dimensions
Rendered size differs from the preset: render the composition at the target's width × height, never scale in the encode.

### probe.even
H.264 4:2:0 needs even dimensions: keep `scale=trunc(iw/2)*2:trunc(ih/2)*2` in the encode or fix the canvas size.

### probe.fps
Frame rate differs from the plan/preset: render the PNG sequence and encode both at the composition's fps (`-framerate` and `-r`).

### probe.duration
Duration is outside the preset bounds: change the composition's `data-duration` (and the plan) to fit, then re-render.

### probe.size
File exceeds the platform cap: encode with the size-cap bitrate solver (two-pass `-b:v`) or CRF 23.

### probe.codec
MP4 must be H.264: encode with `-c:v libx264 -profile:v high`.

### probe.pix-fmt
MP4 must be yuv420p: add `-pix_fmt yuv420p` (and `format=yuv420p` in the filter chain).

### probe.bt709
Colour tags missing: add `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` to the encode.

## palette

### palette.static
Replace the literal with the nearest brand role variable (`var(--…)` from `brand.css`); translucent black/white shadows and scrims are allowed.

### palette.sampled
A dominant rendered colour is off-brand: find the layer (image, gradient stop, filter, blend mode) producing it and use brand roles or their mixes.

## loudness (dist only)

### loudness.integrated
Integrated loudness off target (−14 LUFS social, −16 narration-only): re-run the two-pass `loudnorm` with the target `I`.

### loudness.true-peak
True peak above −1 dBTP: lower `TP` in `loudnorm` or add a limiter before the encode.

### loudness.lra
Loudness range above 11 LU: compress the music bed or duck it under the voice-over.

## ad-lint (mode `ad`)

### ad.frames
No full PNG sequence to measure: render the proof/dist frame sequence (or pass `--frames <dir>`) so frame rules can run.

### ad.first-change
Nothing visibly changes in the first 0.5 s: start the hook animation at t = 0 (no fade-up, logo card or empty hold before it).

### ad.empty-start
Frame 0 is a flat colour: put the hook text, product or brand mark on screen at t = 0.

### ad.flash
More than 3 opposing ≥ 10% luminance changes within 1 s (WCAG 2.3.1): slow the cuts, reduce the contrast of strobing elements.

### ad.end-card
The end card moves: hold a static end card (CTA + brand) for the last 1.5 s (2 s for a 6 s bumper); stop ambient motion there.

### ad.duration
Duration outside the ad ladder: bumper exactly 6 s; vertical ads 6–15 s; feed 6–30 s; never above 60 s paid.

### ad.headline-words
Headline too long or missing: cut it to ≤ 7 words (≤ 5 for a bumper); 2–5 is ideal.

### ad.cta
No CTA: set `plan.copy.cta` and show it on the end card for ≥ 1.5 s.

### ad.caption-line
A caption line exceeds 42 characters: break at a clause boundary (≤ 32 for 9:16 big type).

### ad.caption-lines
A caption cue has more than 2 lines: split it into two cues.

## guide-lint (mode `guide`)

### guide.steps
`plan.steps` is empty: write the steps JSON (`{ index, action, selector, narration, caption, start, duration, zoom }`).

### guide.pace
One action per 2–4 s: merge micro-steps or split long ones; under 1 s the viewer cannot follow.

### guide.gap
Two actions closer than 0.5 s: add a pause after the click (0.5 s, 0.8–1 s if the UI changes).

### guide.zoom
Zoom above 2× (fail above 2.5×): use 1.5× for dense areas, 2× for small controls; capture at 2× DPR instead of zooming further.

### guide.caption-line
A caption line exceeds 42 characters: shorten it or break at a clause boundary.

### guide.caption-lines
A caption wraps to more than 2 lines: shorten it to one clause or split the step.

### guide.caption-hold
Caption-only variant shows a caption too briefly: extend the step to max(1.2 s, characters / 15).

### guide.narration-words
Narration sentence over 12 words: one short sentence per action with the exact UI label.

### guide.verb-first
Narration does not start with an imperative verb: start with the action ("Click Save", "Abrí el menú").

### guide.chapter
Chapter longer than 40 s: split it with a chapter card.

### guide.total
Video longer than 2 minutes: split into several guides or cut steps.

## seams (`seam-gate.mjs verify`, when `project/ledger.json` or `project/<target>/ledger.json` exists)

### seam.error
seam-gate failed without a verdict: run it by hand (`node ~/.claude/skills/motion-doctrine/scripts/seam-gate.mjs verify --ledger ledger.json --project .`) and fix the ledger or preview.

### seam.ledger
The ledger row is invalid: fix the seam entry in `ledger.json` (motion-doctrine `references/seam-gate.md`).

### seam.exit
The exit selector in the ledger is not in the composition: fix the selector.

### seam.entry
The entry selector in the ledger is not in the composition: fix the selector.

### seam.exit-visible
The exiting element is invisible at the cut: keep it on screen until the boundary.

### seam.entry-visible
The entering element is invisible at the cut: make it visible from the first frame after the cut.

### seam.exit-moving
The exit settles before the cut: keep it moving through the boundary (motion carries the seam).

### seam.entry-moving
The entry starts from rest: start it already in motion on the first frame after the cut.

### seam.exit-direction
Exit moves against the ledger's vector: match the declared direction.

### seam.entry-direction
Entry moves against the ledger's vector: match the declared direction.

### seam.exit-vector
Exit vector differs from the ledger: align axis and sign with the declared vector.

### seam.entry-vector
Entry vector differs from the ledger: align axis and sign with the declared vector.

### seam.speed-match
Entry and exit speeds differ by more than 3×: match velocities across the cut.

### seam.zero-overlap
Outgoing and incoming layers overlap or leave a gap at the cut: make the hand-off frame-exact.

### seam.z-sign-scan
Depth (scale) direction flips across the cut: keep the Z sign consistent (push stays push).

### seam.carrier
A non-cut seam has no carrier, or the carrier check is advisory: declare the carrier element in the ledger.

### seam.carrier-position
The carrier jumps across the cut: keep its centre within 12 px on both sides.

### seam.carrier-size
The carrier changes size across the cut: check ancestor scale; keep it within 5%.

### seam.*
See motion-doctrine `references/seam-gate.md` for this check.

## logo-gate (mode `mark`, reads `plan.mark.outDir`)

### logo.files
Re-run `scripts/mark/package.mjs` (without `--no-browser` for the OG card and the brand sheet; with `--font` for the wordmark and lockups).

### logo.stroke-16
A part is thinner than 1 px at 16 px: raise the stroke (monogram weight ≥ 0.12, band weight ≥ 70 units), or ship a simpler glyph for 32 px and below.

### logo.counter-32
A counter closes at 32 px: lower the weight, widen the letter, or drop the counter and use a solid form for small sizes.

### logo.no-gradients
`mark.svg` must be flat paths: move effects to the brand sheet, never into the master.

### logo.mono-single-fill
Rebuild the mono variants with `monoVariant(svg, hex)` so every paint becomes one colour.

### logo.maskable-safe
Make the mark smaller in `icon-maskable-512.png` until it sits inside the centred circle with r = 40%.

### logo.centroid
A centroid far from the bbox centre is normal for triangles: check the optical centre on the brand sheet and set `optical.bias`.

### logo.ssim-16
The 16 px raster loses the form: simplify the mark or provide a dedicated favicon glyph.

### offline.network
A script, stylesheet, font or media URL points at http(s). Vendor the file under the project (gsap.min.js, fonts/, assets/) and reference it relatively.

### offline.font-file
An `@font-face` url names a file that is not in the project. Re-run the brand resolver with fonts (`--refresh`) or fix the font path.

### social.headline-words
The headline has more than 7 words. Cut it; the claim is one line.

### social.loop-seamless
First and last frames of a seamless loop differ by more than 2%. End the timeline one frame before its first state (elements fully exited) or set `loop: hold`.

### promo.captions-mirror-vo
Fewer than 95% of the narrated words appear in the captions. Regenerate captions from the transcript (`voiceover.mjs --transcribe`) or fix the lexicon so the voice reads the words as written.

### probe.pages
A carousel PDF bundle with no slide compositions in the plan. Build the slides (`instances`) before delivering.

### hf:no_project
No `project/<target>/index.html`. Run build.mjs first.

### hf:unavailable
The hyperframes CLI could not run. Install it globally and run doctor.mjs.
