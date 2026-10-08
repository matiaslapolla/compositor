"""Layout probe for generated scenes: what leaves the frame, what text collides.

Scenes call `check_bounds(self)` after a beat, or mix in `BoundsMixin` to get it
after every `play()`. No pass/fail here; the explain-lint gate decides.
Set `mobject.allow_offscreen = True` on things that bleed on purpose.
"""

import json
import os
from itertools import combinations
from pathlib import Path

from manim import (
    DecimalNumber,
    ImageMobject,
    Integer,
    MarkupText,
    MathTex,
    MathTypst,
    NumberLine,
    Tex,
    Text,
    Typst,
    VMobject,
    config,
)

TEXT_CLASSES = (Text, MarkupText, Tex, MathTex, Typst, MathTypst, DecimalNumber, Integer)
OVERLAP_RATIO = 0.05  # share of the smaller box that must be covered before it counts


def _frame(scene) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) of what the camera sees now."""
    frame = getattr(scene.camera, "frame", None)
    if frame is not None and hasattr(frame, "get_center") and frame.has_points():
        cx, cy = frame.get_center()[:2]
        w, h = frame.width, frame.height
    else:
        cx = cy = 0.0
        w, h = config.frame_width, config.frame_height
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


def _bbox(m) -> tuple[float, float, float, float] | None:
    if not len(m.get_all_points()):
        return None
    return (
        float(m.get_left()[0]),
        float(m.get_bottom()[1]),
        float(m.get_right()[0]),
        float(m.get_top()[1]),
    )


def _visible(m) -> bool:
    """Drawn on screen: some vector part has fill or a visible stroke, or it holds an image.
    Non-drawing mobjects (ValueTracker) are never visible."""
    for leaf in m.family_members_with_points():
        if isinstance(leaf, ImageMobject):
            return True
        if isinstance(leaf, VMobject) and (
            leaf.get_fill_opacity() > 0.01 or (leaf.get_stroke_opacity() > 0.01 and leaf.get_stroke_width() > 0)
        ):
            return True
    return False


def _label(m) -> str:
    text = getattr(m, "text", None) or getattr(m, "tex_string", None)
    if text is None and isinstance(m, (DecimalNumber, Integer)):
        text = f"{m.number:g}"
    name = type(m).__name__
    return f"{name}({str(text)[:40]!r})" if text is not None else name


def _round(box) -> list[float]:
    return [round(v, 3) for v in box]


def _text_units(mobjects, owner=None):
    """Text-like mobjects as (mobject, enclosing NumberLine or None); a text object is one unit."""
    for m in mobjects:
        if isinstance(m, TEXT_CLASSES):
            yield m, owner
        else:
            yield from _text_units(m.submobjects, m if isinstance(m, NumberLine) else owner)


def _overlap(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return (w * h) / smaller if smaller > 0 else 0.0


def check_bounds(scene, margin: float = 0.3) -> list[dict]:
    """Findings `{mobject, issue: "offscreen"|"overlap", bbox}` for the mobjects now on screen.

    offscreen: the bbox crosses the frame shrunk by `margin` on any side.
    overlap: two text mobjects share more than 5% of the smaller box; the
    finding names the second one in `with`.
    """
    fx0, fy0, fx1, fy1 = _frame(scene)
    findings: list[dict] = []
    for m in scene.mobjects:
        box = _bbox(m)
        if box is None or getattr(m, "allow_offscreen", False) or not _visible(m):
            continue
        if box[0] < fx0 + margin or box[1] < fy0 + margin or box[2] > fx1 - margin or box[3] > fy1 - margin:
            findings.append({"mobject": _label(m), "issue": "offscreen", "bbox": _round(box)})

    units = []
    for m, owner in _text_units(scene.mobjects):
        box = _bbox(m)
        if box is not None and _visible(m):
            units.append((m, owner, box))
    for (ma, oa, ba), (mb, ob, bb) in combinations(units, 2):
        if oa is not None and oa is ob:
            continue  # tick labels of one axis crowd the origin by design
        if _overlap(ba, bb) > OVERLAP_RATIO:
            findings.append({"mobject": _label(ma), "issue": "overlap", "bbox": _round(ba), "with": _label(mb)})
    return findings


class BoundsMixin:
    """Put first in the bases: `class Episode(BoundsMixin, ExplainerScene)`.

    Checks after every `play()`, keeps each distinct finding once in
    `scene.bounds_findings` (with the beat index and scene time), and writes
    `bounds.json` at the end: to $COMPOSITOR_BOUNDS_OUT, else next to the video.
    """

    bounds_margin = 0.3

    def setup(self) -> None:
        super().setup()
        self.bounds_findings: list[dict] = []
        self._bounds_seen: set[tuple] = set()
        self._bounds_beat = 0

    def play(self, *args, **kwargs) -> None:
        super().play(*args, **kwargs)
        self._bounds_beat += 1
        for f in check_bounds(self, self.bounds_margin):
            key = (f["mobject"], f["issue"], f.get("with"), tuple(f["bbox"]))
            if key not in self._bounds_seen:
                self._bounds_seen.add(key)
                self.bounds_findings.append({**f, "beat": self._bounds_beat, "time": round(self.time, 2)})

    def tear_down(self) -> None:
        super().tear_down()
        target = os.environ.get("COMPOSITOR_BOUNDS_OUT")
        path = Path(target) if target else Path(config.get_dir("video_dir")) / "bounds.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        x0, y0, x1, y1 = _frame(self)
        payload = {"frame": [x1 - x0, y1 - y0], "margin": self.bounds_margin, "findings": self.bounds_findings}
        path.write_text(json.dumps(payload, indent=2) + "\n")
