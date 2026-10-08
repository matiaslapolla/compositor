"""Voice comparison TUI: one paragraph, every candidate voice, same pipeline
as the videos (sentence split, lexicon, pauses).

Usage: python -m explainer.voices
"""

import hashlib
import json
import time
from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import DataTable, Footer, Header, Label, TextArea

from explainer.engines import (
    CATALOG,
    PARAM_LABELS,
    PARAMS,
    Voice,
    catalog,
    download,
    house,
    is_downloaded,
    save_house,
)
from explainer.player import play
from explainer.synth import narrate, write_wav

OUT = Path(__file__).parent.parent / "out" / "voices"
SCORES = OUT / "scores.json"


def paragraphs() -> dict[str, str]:
    import tomllib

    with CATALOG.open("rb") as f:
        return {k: v.strip() for k, v in tomllib.load(f)["paragraph"].items()}


def wav_for(voice: Voice, text: str) -> Path:
    key = json.dumps([voice.id, voice.lang, sorted((k, voice.param(k)) for k in PARAMS[voice.engine]), text])
    return OUT / f"{voice.name}-{hashlib.sha256(key.encode()).hexdigest()[:10]}.wav"


class VoicesApp(App):
    TITLE = "Voices"
    SUB_TITLE = "compare candidates for the house voice"
    CSS = """
    #texts { height: 9; }
    #texts TextArea { width: 1fr; }
    #params { height: 3; padding: 0 1; color: $text-muted; }
    DataTable { height: 1fr; }
    """
    BINDINGS = [
        Binding("enter", "play", "Play"),
        Binding("space", "stop", "Stop"),
        Binding("b", "back", "A/B: previous"),
        Binding("d", "download", "Download"),
        Binding("p", "next_param", "Param"),
        Binding("left_square_bracket", "nudge(-1)", "Param −", key_display="["),
        Binding("right_square_bracket", "nudge(1)", "Param +", key_display="]"),
        Binding("h", "make_house", "Use for videos"),
        Binding("1", "score(1)", "Score", key_display="1-5"),
        *(Binding(str(n), f"score({n})", show=False) for n in range(2, 6)),
        Binding("tab", "focus_next", "Focus", show=False),
        Binding("q", "quit", "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.house = house()
        self.voices = [self.house if v.id == self.house.id else v for v in catalog()]
        if self.house.id not in {v.id for v in self.voices}:
            self.voices.insert(0, self.house)
        self.param_index = 0
        self.player = None
        self.history: list[int] = []
        self.timing: dict[str, str] = {}
        self.scores: dict[str, int] = json.loads(SCORES.read_text()) if SCORES.exists() else {}
        OUT.mkdir(parents=True, exist_ok=True)

    def compose(self) -> ComposeResult:
        yield Header()
        texts = paragraphs()
        with Horizontal(id="texts"):
            yield TextArea(texts["es"], id="es")
            yield TextArea(texts["en"], id="en")
        with Vertical():
            yield Label(id="params")
            yield DataTable(cursor_type="row", zebra_stripes=True)
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_columns("", "voice", "lang", "params", "status", "synth", "score", "note")
        self.refresh_table()
        table.focus()

    @property
    def table(self) -> DataTable:
        return self.query_one(DataTable)

    @property
    def row(self) -> int:
        return self.table.cursor_row

    def text_for(self, voice: Voice) -> str:
        return self.query_one(f"#{voice.lexicon_lang}", TextArea).text.strip()

    def refresh_table(self) -> None:
        table, cursor = self.table, self.table.cursor_row
        table.clear()
        for v in self.voices:
            params = " ".join(f"{PARAM_LABELS[k][0]}={v.param(k):g}" for k in PARAMS[v.engine])
            status = "ready" if is_downloaded(v) else "[dim]not downloaded[/]"
            if is_downloaded(v) and wav_for(v, self.text_for(v)).exists():
                status = "[green]synthesized[/]"
            table.add_row(
                "★" if v.id == self.house.id else "",
                v.id,
                v.lang,
                params,
                status,
                self.timing.get(v.id, ""),
                "●" * self.scores.get(v.id, 0),
                v.note,
            )
        table.move_cursor(row=min(cursor, len(self.voices) - 1))
        self.show_params()

    def show_params(self) -> None:
        if not self.voices:
            return
        v = self.voices[self.row]
        keys = list(PARAMS[v.engine])
        key = keys[self.param_index % len(keys)]
        label, hint = PARAM_LABELS[key]
        self.query_one("#params", Label).update(
            f"[b]{v.id}[/b]   {label} = [b]{v.param(key):g}[/b]  ({hint})\n"
            "enter play · b replay previous (A/B) · p next param · [ ] change · h use for videos"
        )

    def on_data_table_row_highlighted(self, _) -> None:
        self.show_params()

    def on_data_table_row_selected(self, _) -> None:
        self.action_play()

    def action_play(self) -> None:
        voice = self.voices[self.row]
        if not is_downloaded(voice):
            self.notify(f"{voice.id} is not downloaded: press d", severity="warning")
            return
        if not self.history or self.history[-1] != self.row:
            self.history.append(self.row)
        self.synthesize_and_play(voice, self.text_for(voice))

    @work(thread=True, exclusive=True, group="synth")
    def synthesize_and_play(self, voice: Voice, text: str) -> None:
        path = wav_for(voice, text)
        if not path.exists():
            self.call_from_thread(self.notify, f"synthesizing {voice.id}…")
            start = time.perf_counter()
            result = narrate(text, voice)
            took = time.perf_counter() - start
            write_wav(path, result)
            self.timing[voice.id] = f"{took:.1f}s for {result.duration:.0f}s"
        self.call_from_thread(self.start_playback, path)
        self.call_from_thread(self.refresh_table)

    def start_playback(self, path: Path) -> None:
        self.action_stop()
        self.player = play(path)

    def action_stop(self) -> None:
        if self.player and self.player.poll() is None:
            self.player.terminate()

    def action_back(self) -> None:
        if len(self.history) >= 2:
            self.table.move_cursor(row=self.history[-2])
            self.action_play()

    def action_download(self) -> None:
        voice = self.voices[self.row]
        if is_downloaded(voice):
            self.notify(f"{voice.id} already downloaded")
            return
        self.fetch(voice)

    @work(thread=True, group="download")
    def fetch(self, voice: Voice) -> None:
        size = "~350 MB, once for every Kokoro voice" if voice.engine == "kokoro" else "20–115 MB"
        self.call_from_thread(self.notify, f"downloading {voice.id} ({size})…")
        try:
            download(voice)
        except Exception as e:  # noqa: BLE001 - surface any network failure in the UI
            self.call_from_thread(self.notify, f"{voice.id}: {e}", severity="error")
            return
        self.call_from_thread(self.notify, f"{voice.id} ready")
        self.call_from_thread(self.refresh_table)

    def action_next_param(self) -> None:
        self.param_index += 1
        self.show_params()

    def action_nudge(self, direction: int) -> None:
        i = self.row
        v = self.voices[i]
        keys = list(PARAMS[v.engine])
        key = keys[self.param_index % len(keys)]
        step = PARAMS[v.engine][key][1]
        self.voices[i] = v.with_param(key, max(0.05, v.param(key) + direction * step))
        self.refresh_table()

    def action_make_house(self) -> None:
        voice = self.voices[self.row]
        if not is_downloaded(voice):
            self.notify("download it first (d)", severity="warning")
            return
        save_house(voice)
        self.house = voice
        self.refresh_table()
        note = "" if voice.lexicon_lang == "es" else " Episodes must then be narrated in English."
        self.notify(f"house voice → {voice.id}. Re-render episodes to hear it.{note}")

    def action_score(self, n: int) -> None:
        self.scores[self.voices[self.row].id] = n
        SCORES.write_text(json.dumps(self.scores, indent=2))
        self.refresh_table()

    def on_unmount(self) -> None:
        self.action_stop()


if __name__ == "__main__":
    VoicesApp().run()
