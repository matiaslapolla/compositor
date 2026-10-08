import pytest
from manim import RIGHT, Circle, Scene, Text, ValueTracker, config

from bounds import check_bounds


@pytest.fixture(autouse=True)
def media_in_tmp(tmp_path):
    config.media_dir = str(tmp_path)


def scene_with(*mobjects):
    scene = Scene()
    scene.add(*mobjects)
    return scene


def test_offscreen_mobject_is_reported_and_inside_one_is_not():
    findings = check_bounds(scene_with(Circle(radius=1), Circle(radius=2).shift(RIGHT * 6.5)))
    assert [(f["mobject"], f["issue"]) for f in findings] == [("Circle", "offscreen")]
    assert findings[0]["bbox"][2] > 7.1


def test_margin_shrinks_the_frame():
    box = Circle(radius=0.5).shift(RIGHT * 6.5)
    assert check_bounds(scene_with(box), margin=0.0) == []
    assert [f["issue"] for f in check_bounds(scene_with(box), margin=0.3)] == ["offscreen"]


def test_overlapping_text_is_reported_once_with_its_partner():
    a, b = Text("A", font_size=48), Text("B", font_size=48).shift(RIGHT * 0.1)
    [finding] = check_bounds(scene_with(a, b))
    assert finding["issue"] == "overlap" and finding["with"].startswith("Text")


def test_separate_text_invisible_text_and_trackers_are_ignored():
    near, far = Text("A", font_size=48), Text("B", font_size=48).shift(RIGHT * 3)
    ghost = Text("C", font_size=48).set_opacity(0)
    assert check_bounds(scene_with(near, far, ghost, ValueTracker(9))) == []


def test_allow_offscreen_opts_out():
    bleed = Circle(radius=2).shift(RIGHT * 6.5)
    bleed.allow_offscreen = True
    assert check_bounds(scene_with(bleed)) == []
