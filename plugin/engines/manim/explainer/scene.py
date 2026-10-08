"""ExplainerScene: a VoiceoverScene with the house voice, theme and a few helpers."""

from manim import (
    DOWN,
    UL,
    UP,
    Axes,
    DecimalNumber,
    FadeOut,
    MathTypst,
    NumberLine,
    Text,
    VGroup,
    Write,
)
from manim_voiceover import VoiceoverScene

from explainer import theme
from explainer.voice import HouseVoiceService


class ExplainerScene(VoiceoverScene):
    def setup(self) -> None:
        super().setup()
        self.camera.background_color = theme.BG
        Text.set_default(font=theme.FONT, color=theme.INK)
        MathTypst.set_default(color=theme.INK)
        # Manim defaults these to MathTex; Text keeps the whole stack LaTeX-free.
        DecimalNumber.set_default(mob_class=Text)
        NumberLine.set_default(label_constructor=Text)
        self.set_speech_service(HouseVoiceService())

    def narrate(self, text: str, *animations, **play_kwargs) -> None:
        """Speak `text` while `animations` run for exactly as long as the voice."""
        with self.voiceover(text=text) as tracker:
            if animations:
                self.play(*animations, run_time=tracker.duration, **play_kwargs)

    def chapter(self, name: str) -> None:
        """Start a section (one file per chapter with --save_sections) and
        fade out whatever is on screen."""
        if self.mobjects:
            self.play(*(FadeOut(m) for m in self.mobjects), run_time=0.4)
        self.next_section(name)

    def title_card(self, title: str, kicker: str | None = None) -> VGroup:
        card = VGroup(Text(title, font_size=56, weight="BOLD"))
        if kicker:
            card.add(Text(kicker, font_size=26, color=theme.MUTED).next_to(card[0], UP, buff=0.3))
        return card

    def header(self, text: str) -> Text:
        return Text(text, font_size=28, color=theme.MUTED).to_corner(UL)

    def math(self, expression: str, **kwargs) -> MathTypst:
        """Typst math (no LaTeX needed). Group with {{ part : label }} and
        color later with .select("label")."""
        return MathTypst(expression, **kwargs)

    def axes(self, x_range=(0, 10, 1), y_range=(0, 10, 1), **kwargs) -> Axes:
        return Axes(
            x_range=x_range,
            y_range=y_range,
            x_length=kwargs.pop("x_length", 7),
            y_length=kwargs.pop("y_length", 4.5),
            axis_config={"color": theme.MUTED, "include_tip": False, "stroke_width": 2},
            **kwargs,
        )

    def show_title(self, title: str, kicker: str | None = None, line: str | None = None) -> None:
        card = self.title_card(title, kicker)
        if line:
            self.narrate(line, Write(card))
        else:
            self.play(Write(card))
        self.play(FadeOut(card, shift=DOWN * 0.3), run_time=0.5)
