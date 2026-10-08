"""Explainer-video framework: Manim + manim-voiceover + local Piper voice."""

import logging


def __getattr__(name: str):
    # Lazy so `explainer.lint` and the tests never import Manim.
    if name == "ExplainerScene":
        # sox warns at import when its binary is absent; speed goes through
        # Piper's length_scale instead, so sox is never used.
        logging.getLogger("sox").disabled = True
        from explainer.scene import ExplainerScene

        return ExplainerScene
    raise AttributeError(name)
