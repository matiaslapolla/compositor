"""Narration text model: sentences, pronunciation and word timing.

Pure functions, no audio. The speech service feeds it what Piper returns.
"""

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

# Same pattern manim_voiceover.helper.remove_bookmarks uses, so text offsets agree.
BOOKMARK = re.compile(r"<bookmark\s*mark\s*=['\"]\w*[\"']\s*/>")
SENTENCE_END = re.compile(r"[.!?…][\"'»)]*$")
EDGE_PUNCTUATION = re.compile(r"^(\W*)(.*?)(\W*)$")

# Matches manim_voiceover.tracker.AUDIO_OFFSET_RESOLUTION.
AUDIO_OFFSET_RESOLUTION = 10_000_000


def strip_bookmarks(text: str) -> str:
    return BOOKMARK.sub("", text)


def load_lexicon(path: Path, lang: str) -> dict[str, str]:
    with path.open("rb") as f:
        return {k.lower(): v for k, v in tomllib.load(f).get(lang, {}).items()}


@dataclass(frozen=True)
class Word:
    text: str
    offset: int
    spoken: str

    @property
    def is_word(self) -> bool:
        return re.search(r"\w", self.text) is not None

    @property
    def spoken_count(self) -> int:
        """Words the voice says for this token; espeak gives bare punctuation no word."""
        return len(self.spoken.split()) if self.is_word else 0


@dataclass(frozen=True)
class Sentence:
    words: tuple[Word, ...]

    @property
    def spoken(self) -> str:
        return " ".join(w.spoken for w in self.words)

    @property
    def start(self) -> int:
        return self.words[0].offset

    @property
    def end(self) -> int:
        last = self.words[-1]
        return last.offset + len(last.text)


def speak(token: str, lexicon: dict[str, str]) -> str:
    prefix, core, suffix = EDGE_PUNCTUATION.match(token).groups()
    replacement = lexicon.get(core.lower())
    return token if replacement is None else f"{prefix}{replacement}{suffix}"


def parse(text: str, lexicon: dict[str, str] | None = None) -> list[Sentence]:
    """Split bookmark-free text into sentences of words, with offsets into `text`."""
    lexicon = lexicon or {}
    sentences: list[Sentence] = []
    current: list[Word] = []
    for match in re.finditer(r"\S+", text):
        token = match.group()
        current.append(Word(token, match.start(), speak(token, lexicon)))
        if SENTENCE_END.search(token):
            sentences.append(Sentence(tuple(current)))
            current = []
    if current:
        sentences.append(Sentence(tuple(current)))
    return sentences


def word_starts(phonemes: list[tuple[str, float]]) -> list[float]:
    """Start time of each spoken word from (phoneme, start seconds) pairs.

    espeak-based engines separate words with a " " phoneme; Piper also wraps
    the sentence in "^" and "$".
    """
    starts: list[float] = []
    expecting_word = True
    for phoneme, start in phonemes:
        if phoneme == " ":
            expecting_word = True
        elif phoneme not in ("^", "$") and expecting_word:
            starts.append(start)
            expecting_word = False
    return starts


@dataclass(frozen=True)
class SentenceTiming:
    start: float
    duration: float
    word_starts: list[float] | None


def word_boundaries(
    text: str, sentences: list[Sentence], timings: list[SentenceTiming], total: float
) -> list[dict]:
    """Word boundaries in manim-voiceover's format, one per written word.

    Uses Piper's alignment when its word count matches the spoken text of the
    sentence; otherwise interpolates by character offset inside the sentence,
    so a mismatch only blurs timing within that one sentence.
    """
    boundaries = []
    for sentence, timing in zip(sentences, timings, strict=True):
        spoken_total = sum(w.spoken_count for w in sentence.words)
        aligned = timing.word_starts is not None and len(timing.word_starts) == spoken_total
        spoken_index = 0
        span = sentence.end - sentence.start
        for word in sentence.words:
            if aligned:
                t = timing.start + timing.word_starts[spoken_index]
            else:
                t = timing.start + timing.duration * (word.offset - sentence.start) / span
            spoken_index += word.spoken_count
            boundaries.append(_boundary(word.text, word.offset, t))
    boundaries.append(_boundary("", len(text), total))
    return boundaries


def _boundary(text: str, offset: int, seconds: float) -> dict:
    return {
        "audio_offset": int(seconds * AUDIO_OFFSET_RESOLUTION),
        "text_offset": offset,
        "word_length": len(text),
        "text": text,
        "boundary_type": "Word",
    }
