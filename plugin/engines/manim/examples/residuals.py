"""Residuos y error cuadrático medio: a complete episode (Spanish narration) to copy from."""

import numpy as np
from manim import (
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Create,
    DecimalNumber,
    Dot,
    FadeIn,
    LaggedStartMap,
    Line,
    Text,
    ValueTracker,
    VGroup,
    Write,
    always_redraw,
)

from bounds import BoundsMixin
from explainer import ExplainerScene, theme

RNG = np.random.default_rng(3)
XS = np.linspace(1, 9, 8)
YS = 0.8 * XS + 1 + RNG.normal(0, 0.9, XS.size)


class Episode(BoundsMixin, ExplainerScene):
    def construct(self):
        self.show_title(
            "Residuos",
            kicker="Regresión lineal",
            line="Hoy medimos qué tan mal ajusta una recta a los datos.",
        )

        ax = self.axes().to_edge(DOWN, buff=0.4).shift(LEFT * 1.5)
        dots = VGroup(*(Dot(ax.c2p(x, y), color=theme.DATA) for x, y in zip(XS, YS, strict=True)))
        self.narrate("Cada punto es una observación.", Create(ax), LaggedStartMap(FadeIn, dots))

        w, b = ValueTracker(0.2), ValueTracker(2.5)

        def predict(x):
            return w.get_value() * x + b.get_value()

        line = always_redraw(lambda: ax.plot(predict, x_range=[0, 10], color=theme.MODEL))
        self.narrate("La recta es el modelo. Para cada equis, predice un valor.", Create(line))

        residuals = always_redraw(
            lambda: VGroup(
                *(
                    Line(ax.c2p(x, y), ax.c2p(x, predict(x)), color=theme.ERROR, stroke_width=3)
                    for x, y in zip(XS, YS, strict=True)
                )
            )
        )
        with self.voiceover(
            text="La distancia vertical entre un punto y la recta se llama <bookmark mark='r'/> residuo."
        ):
            self.wait_until_bookmark("r")
            self.play(Create(residuals), run_time=0.8)

        formula = self.math('"MSE" = 1/n sum_(i=1)^n (y_i - hat(y)_i)^2').scale(0.9)
        formula.to_edge(UP, buff=0.4)
        self.narrate(
            "Elevamos cada residuo al cuadrado y calculamos el promedio. "
            "Ese número es el error cuadrático medio.",
            Write(formula),
        )

        mse = always_redraw(
            lambda: DecimalNumber(
                np.mean((YS - predict(XS)) ** 2), num_decimal_places=2, color=theme.ERROR
            ).next_to(ax, RIGHT, buff=0.6)
        )
        label = Text("MSE", font_size=24, color=theme.MUTED).next_to(mse, UP)
        self.add(mse, label)
        with self.voiceover(
            text="Si la recta se acerca a los puntos, los residuos se achican <bookmark mark='m'/> y el error baja."
        ) as tracker:
            self.play(
                w.animate.set_value(0.8), b.animate.set_value(1.0), run_time=tracker.duration
            )

        self.narrate("Entrenar el modelo es buscar la recta con el menor error.")
