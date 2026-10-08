"""One visual language for every episode: colors carry meaning, not decoration."""

import json
import os
from pathlib import Path

from manim import ManimColor

# A manimTheme() JSON (BG, INK, ..., FONT, MONO) overrides the defaults below.
_OVERRIDE = json.loads(Path(os.environ["COMPOSITOR_THEME"]).read_text()) if os.environ.get("COMPOSITOR_THEME") else {}


def _color(key: str, default: str) -> ManimColor:
    return ManimColor(_OVERRIDE.get(key, default))


BG = _color("BG", "#101318")
INK = _color("INK", "#E8E6E1")
MUTED = _color("MUTED", "#7C8290")
GRID = _color("GRID", "#2A2F38")

# Semantic roles. Keep them stable across episodes so a color means the same thing.
DATA = _color("DATA", "#5FB3D9")  # observations, inputs
MODEL = _color("MODEL", "#F2B84B")  # predictions, the fitted thing
ERROR = _color("ERROR", "#E8705F")  # residuals, loss, what is wrong
SIGNAL = _color("SIGNAL", "#7FD18B")  # gradients, updates, what improves
FOCUS = _color("FOCUS", "#C49BF2")  # the one thing to look at now

FONT = _OVERRIDE.get("FONT", "Noto Sans")
MONO = _OVERRIDE.get("MONO", "Adwaita Mono")
