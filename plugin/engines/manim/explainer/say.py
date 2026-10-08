"""Audition a line with the house voice and lexicon.

Usage: python -m explainer.say "texto a escuchar" [--out out/say.wav]
"""

import argparse
from pathlib import Path

from explainer.engines import house
from explainer.player import play
from explainer.synth import narrate, write_wav


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("text")
    parser.add_argument("--out", default="out/say.wav")
    args = parser.parse_args()

    voice = house()
    result = narrate(args.text, voice)
    print(voice.id, "·", " ".join(s.spoken for s in result.sentences))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_wav(out, result)
    play(out).wait()


if __name__ == "__main__":
    main()
