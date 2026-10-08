# explain mode: authoring contract

The skill writes one Manim episode per video: `class Episode(BoundsMixin, ExplainerScene)` in `<run>/project/episode.py`. Manim CE 0.21, Cairo renderer, Typst math (no LaTeX), the house voice (Kokoro or Piper, local) with word-level sync. Source of the engine: `engines/manim/` (see `engines/manim/README.md`). A working example: `engines/manim/examples/residuals.py`.

## Skeleton

```python
from manim import *
from bounds import BoundsMixin
from explainer import ExplainerScene, theme

class Episode(BoundsMixin, ExplainerScene):
    def construct(self):
        self.show_title("Residuos", kicker="Regresión lineal", line="Hoy medimos qué tan mal ajusta una recta.")
        ax = self.axes().to_edge(DOWN, buff=0.4)
        self.narrate("Cada punto es una observación.", Create(ax))
        with self.voiceover(text="La distancia se llama <bookmark mark='r'/> residuo.") as tracker:
            self.wait_until_bookmark("r")
            self.play(Create(residuals), run_time=0.8)
```

- The class must be named `Episode`; `run.sh` renders `Episode` from the file.
- `BoundsMixin` goes first in the bases. Without it no `bounds.json` is written and the `explain.bounds` rule skips.
- `from manim import *` is fine; colours and fonts always come from `theme`, never from literals or `config.background_color` (the theme-bg rule fails on a different background).

## ExplainerScene helpers

| Helper | Contract |
|---|---|
| `narrate(text, *anims, **play_kwargs)` | Speaks `text`; `anims` run for exactly the voice duration (`run_time=tracker.duration`). Do not pass `run_time`. With no `anims` it only speaks. |
| `voiceover(text=...)` | manim-voiceover context; yields `tracker` (`tracker.duration`). Put `<bookmark mark='x'/>` before the word the screen must react to, then `self.wait_until_bookmark("x")` and play. Bookmark names are `\w+`. |
| `chapter(name)` | Fades out everything on screen (0.4 s) and starts a section. Use between ideas, not between beats. |
| `show_title(title, kicker=None, line=None)` | Title card (56 pt bold + muted kicker), narrated when `line` is given, then fades out. First call of every episode. |
| `header(text)` | Muted 28 pt label in the upper-left corner. |
| `title_card(title, kicker)` | The card as a `VGroup` without playing it. |
| `math(expr, **kw)` | `MathTypst(expr)`. Typst syntax. Group with `{{ part : label }}`; unlabeled `{{ part }}` groups are numbered from 0 among themselves. Select later with `m.select("label")` (or `m.select(0)`), which returns a `VGroup` you can colour, animate or transform. |
| `axes(x_range=(0,10,1), y_range=(0,10,1), x_length=7, y_length=4.5, **kw)` | `Axes` themed (muted, no tips). Tick numbers are off; add `Text` labels yourself. Plot with `ax.plot(f, x_range=[a, b], color=theme.MODEL)`, place with `ax.c2p(x, y)`. |

Setup already done for you: background `theme.BG`; `Text` default font and colour; `MathTypst` default colour; `DecimalNumber` and `NumberLine` labels built from `Text` (so no LaTeX is ever called). Frame: 14.22 x 8 units, centre at the origin.

## Narration rules (enforced by `run.sh lint`)

Only literal strings are read: `narrate(<str>)`, `voiceover(text=<str>)`, `show_title(..., line=<str>)`. An f-string or a variable is not linted, so do not use them for narration.

- A sentence has at most 25 words (error) and should have at most 20 (warning).
- A beat holds at most 3 sentences (warning). One beat is one idea.
- One word per concept: `glossary.toml` (per language of the house voice) lists the approved term and the synonyms that fail (error).
- No symbols, brackets or decimals in narration: `( ) [ ] { } = ^ _ * / \ < > % # | ~` and `0.5` warn. Write them in words; put the symbol on screen.
- Not linted, still required: active voice, present tense, the screen shows what the voice names at the moment it names it (use a bookmark).
- `lexicon.toml` fixes how the voice says a word (`GPU`, `softmax`); it changes audio only, never the subtitles.
- The narration language is the house voice's `lang` (`house-voice.toml`); a run can ship its own with `--home <dir>`.

## Typst, not LaTeX

`math()` and `MathTypst` take Typst math. LaTeX strings fail to compile, and a multi-letter word is an unknown variable (`MSE` fails; write `"MSE"`, or separate the letters: `M S E`). Ten common conversions:

| LaTeX | Typst |
|---|---|
| `\frac{a+b}{c}` | `(a+b)/c` or `frac(a+b, c)` |
| `\sqrt{x}`, `\sqrt[3]{x}` | `sqrt(x)`, `root(3, x)` |
| `\sum_{i=1}^{n} x_{ij}` | `sum_(i=1)^n x_(i j)` (a group after `_`/`^` takes parentheses; letters inside are spaced) |
| `\int_0^1 f(x)\,dx` | `integral_0^1 f(x) dif x` |
| `\hat{y}`, `\bar{x}`, `\vec{v}` | `hat(y)`, `overline(x)`, `arrow(v)` |
| `\alpha \theta \infty \partial \nabla` | `alpha theta infinity partial nabla` (no backslash) |
| `\leq \neq \approx \to \cdot \times` | `<= != approx -> dot times` |
| `\text{if}`, `\operatorname{argmin}` | `"if"`, `op("argmin")` |
| `\begin{pmatrix}1&2\\3&4\end{pmatrix}`, `\binom` | `mat(1, 2; 3, 4)`, `vec(a, b)` |
| `\mathbb{R}`, `\mathbf{x}`, `\mathcal{L}`, `\mathrm{d}` | `RR`, `bold(x)`, `cal(L)`, `upright(d)` |

Also: `\left( \right)` is automatic (`lr(...)` to force); `\quad` is `quad`, `\,` is `thin`; aligned lines use `&` and a backslash newline (`a &= b \ &= c`); `\lim_{x\to0}` is `lim_(x -> 0)`; piecewise is `cases(1 "if" x > 0, 0 "else")`. Quote any text. Morph equations with `TransformMatchingShapes` or by transforming `select(...)` groups, not `TransformMatchingTex`. For prose with maths, use `Text`; `Typst` (markup mode) takes labels only through `#box[...] <label>`.

## Vetted Manim API (use only these unless a render proves otherwise)

- Text and numbers: `Text`, `MathTypst` (via `self.math`), `Typst`, `DecimalNumber`, `Integer`.
- Shapes: `Dot`, `Line`, `DashedLine`, `Arrow`, `DoubleArrow`, `Vector`, `Circle`, `Square`, `Rectangle`, `RoundedRectangle`, `Polygon`, `Arc`, `Annulus`, `Angle`, `RightAngle`.
- Structure: `VGroup`, `Axes` (via `self.axes`), `NumberPlane`, `NumberLine`, `BarChart`, `ArrowVectorField`, `SurroundingRectangle`, `Brace`, `BraceLabel`.
- Dynamics: `ValueTracker` (`.get_value()`, `.animate.set_value(v)`), `always_redraw(lambda: ...)`, `.animate`, `.add_updater`.
- Creation: `Create`, `Write`, `Unwrite`, `Uncreate`, `DrawBorderThenFill`, `FadeIn(m, shift=UP*0.3)`, `FadeOut`, `GrowFromCenter`, `GrowArrow`.
- Change: `Transform`, `ReplacementTransform`, `TransformMatchingShapes`, `FadeTransform`, `Rotate`, `MoveAlongPath`.
- Emphasis: `Indicate`, `Circumscribe`, `FocusOn`, `Flash`, `ShowPassingFlash`.
- Composition: `LaggedStart`, `LaggedStartMap`, `AnimationGroup`, `Succession`.
- Rate functions: `smooth` (default), `linear`, `rush_into`, `rush_from`, `there_and_back`.
- Constants and placement: `UP DOWN LEFT RIGHT UL UR DL DR ORIGIN IN OUT PI TAU DEGREES`; `.to_edge`, `.to_corner`, `.next_to(obj, DIR, buff=)`, `.move_to`, `.shift`, `.scale`, `.arrange(DIR, buff=)`, `.align_to`, `.set_color`, `.set_opacity`.

Avoid: `Tex`, `MathTex`, `SingleStringMathTex` (need LaTeX), `TransformMatchingTex`, `ThreeDScene`/camera moves (not tested with the voice scene), `Code`, `ImageMobject` from the web, OpenGL renderer, any API not in the list above that you have not seen render. An API error is a bug in the call, not a reason to try a different class from memory: read the traceback.

## 3Blue1Brown timing conventions

- `smooth` rate function everywhere; default `run_time` 1 s. `Write` 1 to 2 s, `Transform` 1 to 1.5 s, `FadeIn`/`FadeOut` 0.4 to 0.6 s.
- Narrated animations take the voice's length (`narrate`); never shorten them by hand. Silent pauses: `self.wait(1)` after a result lands, `self.wait(0.5)` between small steps.
- One new thing per beat: introduce, then name it (bookmark on the name), then move on. Build equations term by term; highlight with `Indicate`/`Circumscribe`, not by redrawing.
- Keep the object that carries the idea on screen across beats; fade out supporting detail before the next idea (`chapter` does it for a whole section).
- Never exceed 3 sentences of voice per beat; a long explanation is several beats with different pictures.

## Colour roles

Colours carry meaning and stay stable across episodes. Always `theme.X`:

| Theme role | Meaning | Brand role it comes from (`manimTheme`) |
|---|---|---|
| `BG` | background | `color.video.nearBlack` on a dark canvas, else `bg` |
| `INK` | text, default stroke | `fg` |
| `MUTED` | axes, labels, kickers | `muted` |
| `GRID` | grid lines, faint structure | `border` |
| `DATA` | observations, inputs | `accent` |
| `MODEL` | predictions, the fitted thing | `warning` |
| `ERROR` | residuals, loss, what is wrong | `error` |
| `SIGNAL` | gradients, updates, what improves | `success` |
| `FOCUS` | the one thing to look at now | the other canvas's `accent` (or `warning` when equal) |

Use at most one `FOCUS` object at a time. `theme.FONT` and `theme.MONO` are the brand display and mono families; `Text` already uses `FONT`. Generate the mapping with `theme-from-brand.mjs`; to check a theme against the brand look at `theme.json` before rendering (a low-contrast `FOCUS` on `BG` is a brand problem, flag it).

## Proof, bounds, render loop

1. Storyboard first: beats with narration text, what is on screen when each key word is spoken, and which colour role each object has. Layout problems are fixed here, not in code.
2. Write `episode.py`; `run.sh lint` until clean.
3. Proof: `run.sh preview` (480p15, no cache) writes `<run>/proof/<ep>-preview.mp4`, `.srt`, `bounds.json`; then `run.sh frames` and look at the contact sheet and any frame in doubt.
4. Gate: `node scripts/gates/explain-lint.mjs <runDir>`. `explain.narration` errors and `explain.bounds` offscreen findings fail; overlaps and lint warnings warn; `explain.theme-bg` fails when the background is not the theme `BG`.
5. On failure fix and go to 3. Retry cap: 5 proof iterations. A traceback or API error: fix the call. A layout failure (offscreen, overlap, crowded frame): go back to the storyboard and change the layout, do not nudge coordinates blindly. After 5, stop and report the remaining findings.
6. Render only when the proof is clean: `run.sh render` (1080p60). Check the final mp4 once with `frames`.

For beats that must be checked mid-scene, call `check_bounds(self)` (from `bounds`) after the `play`; it returns `[{mobject, issue: "offscreen" | "overlap", bbox, with?}]`. Frame margin 0.3. Set `mobj.allow_offscreen = True` for things that bleed on purpose. Python reports, the JS gate decides.

## Commands

```sh
S=scripts/explain
node $S/theme-from-brand.mjs --brand compositor/brand.json --out <run>/theme.json [--mode dark|light]
$S/run.sh setup                                   # once: uv env + house voice (needs uv, network)
$S/run.sh doctor                                  # python, manim, typst, ffmpeg, sox, voice
$S/run.sh lint <run>/project/episode.py [--json]
$S/run.sh preview <run>/project/episode.py --out <run>/proof --theme <run>/theme.json [--home <dir>]
$S/run.sh frames <run>/proof/episode-preview.mp4 --out <run>/proof/frames
$S/run.sh render <run>/project/episode.py --out <run>/dist/explain --theme <run>/theme.json [--quality h|k]
$S/run.sh say "Usamos PyTorch en la GPU."          # audition a line
node scripts/gates/explain-lint.mjs <run>          # plan.explain = { episode, theme?, bounds?, video?, home? }
```

Environment: `COMPOSITOR_DATA` (env location, default `~/.claude/plugins/data/compositor`), `TTS_MODELS_DIR` (voice models, default `$COMPOSITOR_DATA/models`), set by `--theme` / `--home`: `COMPOSITOR_THEME`, `FONTCONFIG_FILE`, `COMPOSITOR_EXPLAIN_HOME`. Audio is cached per sentence in `<out>/media/voiceovers`, so a re-render after an animation change does not re-synthesize. `sox` is optional (the house voice does not use it). Brand fonts are copied next to `theme.json` (woff2 converted to TTF with `woff2_decompress` or `uvx fonttools`); without them Manim falls back to a system font and prints a warning.
