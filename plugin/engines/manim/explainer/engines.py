"""Text-to-speech engines behind one interface, plus the voice catalog.

Every engine runs locally and returns, per call, the audio and the start time
of each spoken word (for bookmark sync), or None when it cannot tell.
"""

import os
import tomllib
import urllib.request
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Protocol

import numpy as np

from explainer.narration import word_starts

ROOT = Path(__file__).parent.parent
# A run can override lexicon.toml, glossary.toml and house-voice.toml from another dir.
HOME = Path(os.environ.get("COMPOSITOR_EXPLAIN_HOME", ROOT))


def resolve(name: str) -> Path:
    """`name` from COMPOSITOR_EXPLAIN_HOME when it has one, else the engine's own copy."""
    return HOME / name if (HOME / name).exists() else ROOT / name


CATALOG = ROOT / "voices.toml"
HOUSE = resolve("house-voice.toml")
MODELS = Path(os.environ.get("TTS_MODELS_DIR", Path.home() / "dev/tools/models"))
PIPER_DIR = Path(os.environ.get("PIPER_VOICE_DIR", MODELS / "piper"))
KOKORO_DIR = MODELS / "kokoro"
KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
}
KOKORO_LANG = {"es": "es", "en": "en-us", "en-gb": "en-gb"}

# Tunable knobs per engine, with defaults and the step the TUI nudges them by.
PARAMS = {
    "piper": {
        "length_scale": (1.0, 0.05),
        "noise_scale": (0.667, 0.1),
        "noise_w_scale": (0.8, 0.1),
    },
    "kokoro": {"speed": (1.0, 0.05)},
}
PARAM_LABELS = {
    "length_scale": ("pace", "slower when higher"),
    "noise_scale": ("expression", "pitch and energy variation: higher = livelier, less stable"),
    "noise_w_scale": ("rhythm", "duration variation between sounds"),
    "speed": ("speed", "faster when higher"),
}


@dataclass(frozen=True)
class Speech:
    audio: np.ndarray  # float32 mono in [-1, 1]
    rate: int
    word_starts: list[float] | None


@dataclass(frozen=True)
class Voice:
    engine: str
    name: str
    lang: str  # "es", "en" or "en-gb"; picks the lexicon and the paragraph
    note: str = ""
    params: dict[str, float] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.engine}/{self.name}"

    def param(self, key: str) -> float:
        return self.params.get(key, PARAMS[self.engine][key][0])

    def with_param(self, key: str, value: float) -> "Voice":
        return Voice(self.engine, self.name, self.lang, self.note, {**self.params, key: round(value, 3)})

    @property
    def lexicon_lang(self) -> str:
        return self.lang.split("-")[0]


class Engine(Protocol):
    def say(self, text: str, voice: Voice) -> Speech: ...


class PiperEngine:
    def __init__(self, name: str) -> None:
        from piper import PiperVoice

        self.voice = PiperVoice.load(PIPER_DIR / f"{name}.onnx", include_alignments=True)

    def say(self, text: str, voice: Voice) -> Speech:
        from piper import SynthesisConfig

        config = SynthesisConfig(
            length_scale=voice.param("length_scale"),
            noise_scale=voice.param("noise_scale"),
            noise_w_scale=voice.param("noise_w_scale"),
        )
        rate = self.voice.config.sample_rate
        pieces, phonemes, aligned, cursor = [], [], True, 0
        for chunk in self.voice.synthesize(text, config, include_alignments=True):
            if chunk.phoneme_alignments is None:
                aligned = False
            else:
                at = cursor
                for a in chunk.phoneme_alignments:
                    phonemes.append((a.phoneme, at / rate))
                    at += a.num_samples
            pieces.append(chunk.audio_float_array)
            cursor += len(chunk.audio_float_array)
        audio = np.concatenate(pieces) if pieces else np.zeros(1, np.float32)
        return Speech(audio, rate, word_starts(phonemes) if aligned else None)


class KokoroEngine:
    def __init__(self) -> None:
        from kokoro_onnx import Kokoro

        self.kokoro = Kokoro(str(KOKORO_DIR / "kokoro-v1.0.onnx"), str(KOKORO_DIR / "voices-v1.0.bin"))

    def say(self, text: str, voice: Voice) -> Speech:
        audio, rate, timings = self.kokoro.create_timed(
            text, voice.name, speed=voice.param("speed"), lang=KOKORO_LANG[voice.lang], sentence_pause=0.0
        )
        starts = word_starts([(t.phoneme, t.start) for t in timings]) if timings else None
        return Speech(audio.astype(np.float32), rate, starts)


@cache
def engine_for(engine: str, name: str) -> Engine:
    if engine == "piper":
        return PiperEngine(name)
    if engine == "kokoro":
        return KokoroEngine()
    raise ValueError(f"unknown engine {engine!r}")


def is_downloaded(voice: Voice) -> bool:
    if voice.engine == "piper":
        return (PIPER_DIR / f"{voice.name}.onnx").exists()
    return all((KOKORO_DIR / f).exists() for f in KOKORO_FILES)


def download(voice: Voice) -> None:
    if voice.engine == "piper":
        from piper.download_voices import download_voice

        PIPER_DIR.mkdir(parents=True, exist_ok=True)
        download_voice(voice.name, PIPER_DIR)
        return
    KOKORO_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in KOKORO_FILES.items():
        if not (KOKORO_DIR / name).exists():
            urllib.request.urlretrieve(url, KOKORO_DIR / f"{name}.part")
            (KOKORO_DIR / f"{name}.part").rename(KOKORO_DIR / name)


def _voice(entry: dict) -> Voice:
    params = {k: float(v) for k, v in entry.get("params", {}).items()}
    return Voice(entry["engine"], entry["voice"], entry["lang"], entry.get("note", ""), params)


def catalog() -> list[Voice]:
    with CATALOG.open("rb") as f:
        return [_voice(e) for e in tomllib.load(f)["voice"]]


def house(path: Path = HOUSE) -> Voice:
    with path.open("rb") as f:
        return _voice(tomllib.load(f))


def save_house(voice: Voice, path: Path = HOUSE) -> None:
    lines = [
        "# The voice every episode uses. Written by `python -m explainer.voices` (key h).",
        f'engine = "{voice.engine}"',
        f'voice = "{voice.name}"',
        f'lang = "{voice.lang}"',
        "",
        "[params]",
        *(f"{k} = {voice.param(k)}" for k in PARAMS[voice.engine]),
    ]
    path.write_text("\n".join(lines) + "\n")
