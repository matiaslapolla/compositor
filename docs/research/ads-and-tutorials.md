# Ads, social specs and tutorial craft (2026-10-08)

## Already covered by the base presets (`scripts/targets/presets.mjs`)
ig-feed 1080×1350 (4%), ig-square/linkedin-square 1080² (4%), reels/shorts 1080×1920 (220/65/420/65 px), stories (250/65/250/65), tiktok (108/120/320/60), landscape 1920×1080 (5%), x-image 1200×675, linkedin-image 1200×627, producthunt 1270×760, dribbble 1600×1200, behance-cover 1920×1080, still/brand. Formats mp4/webm/mov/gif/webp/apng/png/png-sequence. Loops seamless/ping-pong/hold, 4–8 s.
Conflict: organic `reels` bottom inset 420 px (21.9%) is below Meta's ad safe zone (35% ≈ 672 px). Add `reels-ad`, do not change the organic preset.

## Targets to add
| Target | px | Safe / notes |
|---|---|---|
| reels-ad / stories-ad | 1080×1920 | top 14% (269), bottom 35% (672), sides 6% (65); bottom 40% with disclaimer (vendor numbers; verify in Ads Manager) |
| tiktok-ad | 1080×1920 | top ≈130, bottom ≈480, right ≈140 (agency measurements); min 540×960 |
| shorts-ad | 1080×1920 | central ≈900×1350 safe; ads tighter (central 50% vertically) |
| yt-thumbnail | 1280×720 | ≤2 MB; key content in central 960×540; avoid bottom-right |
| x-square | 1080×1080 | ≤5 MB; timeline previews crop to 1.91:1 |
| x-landscape-image | 1600×900 | alt to 1200×675 |
| linkedin-portrait | 1080×1350 | organic image / PDF carousel slide |
| linkedin-document (PDF) | 1080×1350 or 1080² per page | ≤100 MB, ≤300 pages, 10–20 best, same ratio every page, RGB; carousel ads strictly 1080², ≤10 cards |
| gda-landscape | 1200×628 (min 600×314) | ≤5120 KB; may be cropped 5% each side |
| gda-square | 1200×1200 (min 300²) | ≤5120 KB |
| gda-portrait | 960×1200 | Demand Gen only; optional |
| gda-logo-square / gda-logo-landscape | 1200×1200 / 1200×300 | ≤5120 KB, transparent PNG |
| RDA text | — | short headline ≤30 (×1–5), long ≤90, description ≤90 (×1–5), business name ≤25 |
| pinterest-pin | 1000×1500 | keep <5 MB; video 2:3/1:1/9:16, 4 s–15 min |
| threads-image | 1080×1350 or 1080² | ≤8 MB; carousel 2–20 |
| threads-video | 1080×1920 | ≤1 GB, ≤5 min |
| bluesky-image | 1200×627 | ≤1 MB (2 MB since Apr 2026 unverified); ≤4 images; JPEG q≈80 |
| bluesky-video | 1080×1920/1920×1080/1080² | MP4 ≤100–300 MB, ≤3 min |

## Video encoding limits
| Platform | Ratios | Max duration | Max size | fps | Bitrate |
|---|---|---|---|---|---|
| Meta feed/Reels/Stories ads | 9:16, 4:5, 1:1 | Reels ads ≤90 s; Stories 15 s/card | 4 GB (<1 GB) | ≤30 (60 ok) | 8–12 Mbps 1080p |
| TikTok organic | 9:16 | 3 s–10 min | 287.6 MB iOS / 72 MB Android | 30 | 4–6 Mbps |
| TikTok ads | 9:16/1:1/16:9 | ≤10 min | 500 MB | — | ≥516 kbps |
| YouTube/Shorts | any; Shorts ≤180 s | — | 256 GB | source | official: 1080p 8 Mbps (12 HFR), 1440p 16/24, 2160p 35–45; AAC-LC 48 kHz 384 kbps; H.264 High, 2 B-frames, closed GOP fps/2, CABAC, 4:2:0, BT.709, faststart |
| X | 16:9, 1:1 | 2:20 (Premium longer) | 512 MB | ≤60 | ≤25 Mbps, target 8–10; max 1920×1200 |
| LinkedIn ads | 16:9, 1:1, 4:5, 9:16 | 3 s–30 min; 15–30 s ideal | 75 KB–200 MB | 30 | 8–12 Mbps; H.264 + AAC 48 kHz |
| LinkedIn organic | same | 3 s–15 min | 5 GB | — | 192 kbps–30 Mbps |
| Pinterest | 2:3, 1:1, 9:16 | 4 s–15 min | 2 GB | — | — |

Loudness: only YouTube documents behaviour (attenuates to ≈−14 LUFS, never boosts). Default −14 LUFS integrated / −1 dBTP / LRA ≤11 for all social; −16 for narration-only/podcast deliverables; EBU R128 −23 only if asked.

## ffmpeg defaults
```bash
# CRF ladder: 18 brand/tutorial, 20 ads, 23 size-capped (X, TikTok Android)
ffmpeg -framerate 30 -i frames/%05d.png -i mix.wav \
  -c:v libx264 -profile:v high -level 4.1 -preset slow -crf 20 \
  -pix_fmt yuv420p -g 15 -keyint_min 15 -bf 2 -sc_threshold 0 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:offset=..:linear=true" \
  -movflags +faststart -map_metadata -1 out.mp4
# pass 1: ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null -
# YouTube: -b:v 10M -maxrate 12M -bufsize 24M, -b:a 384k
# size cap: kbps = (cap_bytes*8/duration_s)*0.92 - audio_kbps; two-pass -b:v
```

## Ad craft rules (each a lint or default)
1. First visible change ≤0.5 s; no logo card/fade/empty frame before t=1.0 s.
2. Brand asset visible by t≤3 s and in ≥70% of frames; brand-led variant also at t=0.
3. Hook text ≤7 words, ≥1.5 s on screen, inside safe box; proposition by t≤3 s; hook complete ≤6 s.
4. Mute-mode pass: every narrated claim mirrored on screen; no "listen" cues.
5. Captions ≤2 lines, ≤42 chars/line (≤32 at 9:16 big type), ≤20 chars/s, hold 0.83–7 s, same anchor, 4.5:1 with box or stroke.
6. Body text ≥4.5% frame height (≥86 px @1920); captions 5–6%; headline ≥8%; overlay reading rate ≤5–10 words/s.
7. One message per shot; ≤2 ideas per ad; ≤1 CTA visible ≥1.5 s; last 2 s = static end card with CTA + brand (hold ≥1.5 s; ≥2 s for bumpers).
8. Bumper 6 s: one visual idea, product on screen, text ≤5 words, close at 4.0–6.0 s, never a cutdown.
9. Duration ladder: Reels/Stories/TikTok top-funnel 6–15 s; feed 15–30 s; LinkedIn 15–30 s; never >60 s paid.
10. Flash lint: >3 opposing ≥10% luminance changes in any 1 s window fails (WCAG 2.3.1); no saturated-red flash pairs; no cuts faster than 3/s.
11. Easing `power2/3.out` or `inOut`; no elastic/bounce on type or logos; ≤1 camera move per shot.
12. Static ad: 1 focal element, headline ≤7 words (2–5 ideal), CTA accent = the 10%, 4.5:1 text, logo in a consistent corner at 4–6% width, text area ≤20%.
13. 60-30-10: 60 base, 30 secondary, 10 accent only on CTA; grayscale ranking headline > product > CTA.
14. Carousel: slide 1 hook + swipe cue, 5–7 slides, hook → context → proof → CTA, same ratio, centre 80% safe, last slide CTA only.
15. Feed autoplay loop 4–8 s seamless, last frame ≠ first frame, no end card (persistent lockup instead).
16. Author once at 9:16 with a safe-box layer; derive 4:5, 1:1, 16:9 by anchoring the safe box and reflowing text, never scaling type below rule 6; export a safe-zone overlay PNG per target.
17. Sound −14 LUFS / −1 dBTP, music ducked ≥6 dB under VO, SFX hit on hook ≤0.3 s.
18. Accessibility: captions always; highlights ≥3:1; no colour-only meaning; reduced-motion variant for web embeds.

Sources: Google ABCDs, Think with Google bumpers, Meta/Nielsen 3-s recall, TikTok Creative Center, Ipsos distinctive assets, Netflix/BBC caption guides, WCAG 2.3.1.

## Tutorial rules (Screen Studio / Arcade / Supademo / Guidde / CANVID; Recordly, Cap open source)
1. Capture at 1440×900 @2x (2880×1800) for 16:9 masters; freeze time and animations (`prefers-reduced-motion`, virtual time), seed data, hide scrollbars and cursor blink.
2. Each step = `{selector, action, narration, caption, zoom?}`; `waitForSelector` + network idle before acting; never sleep for sync.
3. Cursor: cubic Bézier, 24–40 steps, 350–600 ms per move, `power2.inOut`, deterministic control points; cursor rendered as an overlay layer (1.5–2×, soft shadow) over a cursor-less capture.
4. Click ripple 0.4 s 0→48 px, 2 px stroke, accent ≥3:1; pause 0.5 s after click; 0.8–1.0 s if UI changes.
5. Auto-zoom on click/typing: 1.5× (dense) to 2× (small controls), never >2.5× from a 2× capture; ease-in 0.6–0.9 s `power3.out` starting 0.3 s before the click; hold ≥1.2 s; out 0.7 s; merge zooms closer than 1.5 s; pan dead-zone 15%.
6. Spotlight: dim 40–55% (or 6 px blur), rounded cutout r 12–16 px padded 8–12 px, fade 0.25 s, one action at a time.
7. Pacing: one action per 2–4 s; chapter ≤40 s; video ≤2 min; ≥0.5 s between actions.
8. Narration: verb-first imperative, ≤12 words/sentence, one sentence per action, exact UI label, state the result; words ≈ duration_s × 2.5 (150 wpm).
9. TTS Kokoro `af_heart` default (`af_bella`, `bf_emma` UK; `ef_dora` es), speed 1.0 tutorials / 1.05–1.1 demos; measured WPM 140–165 or reject; −16 LUFS narration-only, −14 mixed.
10. Captions from parakeet word timestamps, 1–2 lines ≤42 chars at clause boundaries, bottom safe band outside device frame; caption-only mode shows each ≥ max(1.2 s, chars/15 s).
11. Step chip "Step 2 of 5" top-left at 12–14% from top; chapter card 1.5–2 s, title ≤6 words.
12. Device frame: browser chrome 40–44 px, URL hidden/faked, 6–8% padding, r 16–20 px, shadow `0 40px 90px -20px rgba(0,0,0,.4)`, brand gradient background; frame ≥80% width at 16:9; for 9:16 crop the capture to the step's safe box.
13. Output 1920×1080 default, 3840×2160 for docs/YouTube; 30 fps; CRF 18; never upscale a 1× capture.
14. Captions burned + sidecar SRT/VTT; ring/spotlight ≥3:1; narration and captions carry the same words.
15. Localization: steps/narration/captions in a JSON per locale; recapture with the app's locale flag.

Caveats: Meta Ads Guide, X Help, LinkedIn video specs, BBC guidelines unreachable; rows rely on converging third-party sheets. TikTok safe zone published only as overlay files.
