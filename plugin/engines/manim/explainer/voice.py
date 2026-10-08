"""The house voice as a manim-voiceover SpeechService."""

from pathlib import Path

from manim_voiceover.services.base import SpeechService, initialize_speech_service

from explainer.engines import Voice, house, is_downloaded
from explainer.narration import strip_bookmarks, word_boundaries
from explainer.synth import SENTENCE_PAUSE, narrate, spoken, write_wav


class HouseVoiceService(SpeechService):
    """Speaks with the voice in house-voice.toml (pick it with `python -m explainer.voices`)."""

    def __init__(self, voice: Voice | None = None, **kwargs: object) -> None:
        initialize_speech_service(self, kwargs)
        self.voice = voice or house()
        if not is_downloaded(self.voice):
            raise FileNotFoundError(f"{self.voice.id} not downloaded; press d on it in `python -m explainer.voices`")

    def generate_from_text(self, text, cache_dir=None, path=None, **kwargs):
        cache_dir = Path(cache_dir or self.cache_dir)
        plain = strip_bookmarks(text)
        input_data = {
            "input_text": plain,
            "voice": self.voice.id,
            "params": {k: self.voice.param(k) for k in sorted(self.voice.params)},
            "spoken": [s.spoken for s in spoken(plain, self.voice)],
            "sentence_pause": SENTENCE_PAUSE,
        }
        cached = self.get_cached_result(input_data, cache_dir)
        if cached is not None:
            return cached

        result = narrate(plain, self.voice)
        audio_path = str(path) if path else self.get_audio_basename(input_data) + ".wav"
        write_wav(cache_dir / audio_path, result)
        return {
            "input_text": text,
            "input_data": input_data,
            "original_audio": audio_path,
            "word_boundaries": word_boundaries(plain, result.sentences, result.timings, result.duration),
        }
