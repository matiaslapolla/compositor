"""Narration audio: text → sentences → engine → one WAV with sentence timings.

Shared by the videos (HouseVoiceService) and the voice TUI, so what is
auditioned is exactly what an episode gets. No Manim imports.
"""

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from explainer.engines import Voice, engine_for, resolve
from explainer.narration import Sentence, SentenceTiming, load_lexicon, parse

LEXICON = resolve("lexicon.toml")  # resolved from COMPOSITOR_EXPLAIN_HOME
SENTENCE_PAUSE = 0.3


@dataclass(frozen=True)
class Narration:
    audio: np.ndarray
    rate: int
    sentences: list[Sentence]
    timings: list[SentenceTiming]

    @property
    def duration(self) -> float:
        return len(self.audio) / self.rate


def spoken(text: str, voice: Voice) -> list[Sentence]:
    return parse(text, load_lexicon(LEXICON, voice.lexicon_lang))


def narrate(text: str, voice: Voice, pause: float = SENTENCE_PAUSE) -> Narration:
    """Synthesize sentence by sentence so each sentence start is exact and
    word starts come from the engine's own phoneme timing."""
    sentences = spoken(text, voice)
    engine = engine_for(voice.engine, voice.name)
    pieces: list[np.ndarray] = []
    timings: list[SentenceTiming] = []
    rate = 22050
    elapsed = 0.0
    for i, sentence in enumerate(sentences):
        speech = engine.say(sentence.spoken, voice)
        rate = speech.rate
        if i:
            pieces.append(np.zeros(int(pause * rate), dtype=np.float32))
            elapsed += pause
        pieces.append(speech.audio)
        duration = len(speech.audio) / rate
        timings.append(SentenceTiming(elapsed, duration, speech.word_starts))
        elapsed += duration
    audio = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
    return Narration(audio, rate, sentences, timings)


def write_wav(path: Path, narration: Narration) -> None:
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(narration.rate)
        f.writeframes((np.clip(narration.audio, -1, 1) * 32767).astype(np.int16).tobytes())
