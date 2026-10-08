# Explainer engine: Manim CE vs Motion Canvas vs HTML-native (2026-10-08, measured on this machine)

Machine: Python 3.14.7 (mise), uv 0.12.20, cairo 1.18.4, pango 1.58.2, ffmpeg 9.0.1, chromium 152, RTX 3050, no TeX binaries.

## Recommendation
**Primary: Manim CE 0.21.0, Cairo renderer, `MathTypst` as the default equation path (zero TeX), LaTeX opt-in.** Render scenes to mp4 directly, or to transparent qtrle `.mov` / PNG sequence hosted inside HyperFrames as a clip when brand chrome, captions or a 9:16 recut are needed.
**Secondary (math-light beats inside social/promo):** HTML-native in HyperFrames with MathJax SVG (`fontCache: 'none'`, one `<path>` per glyph) + GSAP MorphSVG (free since GSAP 3.13). Verified: 10 s composition (DrawSVG axes, sine→parabola morph, vector rotate) passed lint and rendered 1080p60 in 11.6 s.
**Reject Motion Canvas**: no official headless render, upstream frozen at 3.17.2 (Dec 2024), forks (Canvas Commons, Revideo 0.11) scattered.

## Matrix
| Criterion | Manim CE 0.21 | Motion Canvas 3.17 | HTML-native |
|---|---|---|---|
| Install | `uv run --python 3.14 --with "manim[typst]"` cold 14 s; cairo/pango present; TeX optional ~220 MB | Node + glue you write | zero |
| Determinism | frame-exact; `--disable_caching` | editor-driven | seek-based by contract |
| LaTeX fidelity | real TeX or Typst (very good) | MathJax | MathJax SVG (KaTeX emits HTML, unsuitable for morphing) |
| Equation morph | `TransformMatchingTex` (keys on tex_string; with `MathTypst` use `TransformMatchingShapes` or `key_map` over `{{ }}` groups) | none | MorphSVG path→path; glyph matching is yours |
| Graph morph | `Transform(ax.plot(f), ax.plot(g))`, `always_redraw` | spline tweens | MorphSVG on `d` (works) |
| Fields / 3D | `ArrowVectorField`, `StreamLines`, `ThreeDScene` | 2D only | Canvas 2D; Three adapter |
| Narration sync | manim-voiceover 0.4.0 (`tracker.duration`, bookmarks) | editor only | native audio tracks, `tts`/`transcribe` |
| AI reliability | huge corpus; TheoremExplainBench 93.8% with 5 retries, 0–7% first try | small corpus | GSAP corpus huge, math layout hand-rolled |
| Theming | per scene constants (`config.background_color`, `Text(font=)`) | TS objects | CSS vars uniformly |
| 10 s @1080p60 | 13.1 s mp4; 13.4 s transparent mov; Typst scene 7 s → 6.2 s | n/a | 11.6 s mp4; 33.6 s ProRes 4444 alpha |
| Alpha / PNG | `-t` qtrle ARGB mov; `--format png`; `-s` last frame | editor exporter | `--format mov|webm`, `png-sequence` |

## Manim facts
- v0.21.0 (2026-08-10), Python ≥ 3.11 through 3.14 (3.14 added in 0.19.2). Renders on 3.14.7 (harmless pydub SyntaxWarning). uv has 3.13.15 cached if `manim-voiceover[transcribe]` (torch) refuses 3.14. The explainer package pins `manim[typst]==0.21.0`, `manim-voiceover==0.4.0`, Python ≥ 3.13.
- 0.21: Cairo ~2.2× faster, cache hashing cheaper, parallel partial-movie encoding; `Typst`/`MathTypst` compile math to SVG without TeX (`typst` 0.15 wheel).
- OpenGL renderer: bug fixes only; use Cairo. GPU irrelevant.
- Flags: `-ql` 854×480@15 (proof), `-qm` 720p30, `-qh` 1080p60, `-qk` 4K; `-t` alpha; `--format png|gif|mp4|webm|mov`; `-s` last frame; `-c` bg; `--fps`; `-r W,H`. Frame 14.22 × 8 units.
- Typst caveat: Claude writes Typst math (`sqrt(a^2+b^2)`, `sum_(k=0)^n`), not LaTeX. Put this in the skill.
- ManimGL (1.7.2, Dec 2024) incompatible API; CE for automation.
- manim-voiceover 0.4.0: services azure/elevenlabs/gemini/gtts/openai/pyttsx3/recorder; no Piper/Kokoro backend upstream. **The explainer package implements `HouseVoiceService` (Kokoro/Piper, phoneme → word timing, bookmarks) and a narration linter; reuse it.** Needs `sox`.
- Optional minimal TeX (~220 MB): `sudo pacman -S --needed texlive-basic texlive-bin texlive-latex texlive-latexextra dvisvgm`.

## The 3b1b look
Palette (Manim CE): BLUE `#58C4DD` (B `#9CDCEB`, D `#29ABCA`, E `#236B8E`), TEAL `#5CD0B3`, GREEN `#83C167`, YELLOW `#F7D96F`, GOLD `#F0AC5F`, RED `#FC6255`, MAROON `#C55F73`, PURPLE `#9A72AC`, PINK `#D147BD`, ORANGE `#FF862F`, GREY_A..E `#DDDDDD/#BBBBBB/#888888/#444444/#222222`. Background `#1C1C1C`–`#333333` (CE default `#000`). Stroke `#DDDDDD`. Easing `smooth` = `sigmoid(10(t−0.5))`, default `run_time` 1.0; `Write` 1–2 s; `Transform` 1–1.5 s with `path_arc`; `self.wait(1)` beats; `MovingCameraScene` zoom `camera.frame.animate.scale(0.5).move_to(obj)`. GSAP `power2.inOut` ≈ `smooth`.

## AI-authored Manim: failure modes and mitigations
TheoremExplainAgent (arXiv 2502.19400): first-attempt success 0–7%, 93%+ after 5 error-feedback retries; errors = API hallucinations (majority), LaTeX syntax, generic Python; layout score 0.57–0.65 vs 0.73 human. Math-To-Manim v2 (2026-10-07): staged brief → dossier → storyboard → scene, AST lint, final-frame probe, gated routing back to the earliest failing stage, `--max-revisions 6`. generative-manim v4 uses renders-or-crashes only.
Mitigations: (1) `MathTypst` default; (2) vetted API subset in the skill, pin `manim==0.21.*`; (3) proof `-ql --disable_caching` then `-s` last-frame PNGs per beat, inspected as images; (4) bounds script after each animation (`m.width ≤ frame_width − margin`, centre inside frame, pairwise bbox overlap for text) returning coordinates; (5) narration timestamps first, `run_time`s in (the voice service does this); (6) cap retries at 5, route layout failures to the storyboard, not the code.
