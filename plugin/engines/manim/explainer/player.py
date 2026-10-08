import shutil
import subprocess
from pathlib import Path


def play(path: Path) -> subprocess.Popen:
    """Play a WAV in the background; terminate() the result to stop it."""
    for cmd in (["pw-play"], ["paplay"], ["aplay", "-q"], ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]):
        if shutil.which(cmd[0]):
            return subprocess.Popen([*cmd, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    raise RuntimeError("no audio player found (pw-play, paplay, aplay or ffplay)")
