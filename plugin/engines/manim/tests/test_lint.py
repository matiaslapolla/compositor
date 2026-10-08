from explainer.lint import check, narration

FORBIDDEN = {"costo": "pérdida"}


def test_narration_finds_literal_strings_in_narrating_calls():
    source = '''
class Episode:
    def construct(self):
        self.narrate("Primera línea.", Write(x))
        with self.voiceover(text="Segunda línea.") as t:
            pass
        self.show_title("Título", line="Tercera línea.")
        self.play(Write(Text("no es narración")))
'''
    assert [t for _, t in narration(source)] == ["Primera línea.", "Segunda línea.", "Tercera línea."]


def test_long_sentence_is_an_error():
    text = " ".join(["palabra"] * 26) + "."
    assert [f.level for f in check(text, 1, {})] == ["error"]


def test_medium_sentence_is_a_warning():
    text = " ".join(["palabra"] * 22) + "."
    assert [f.level for f in check(text, 1, {})] == ["warn"]


def test_bookmarks_do_not_count_as_words():
    text = " ".join(["palabra <bookmark mark='A'/>"] * 20) + "."
    assert check(text, 1, {}) == []


def test_forbidden_synonym_is_an_error():
    [finding] = check("El costo baja.", 1, FORBIDDEN)
    assert finding.level == "error" and "pérdida" in finding.message


def test_synonym_match_is_whole_word():
    assert check("Costoso no es el término.", 1, FORBIDDEN) == []


def test_symbols_and_decimals_warn():
    levels = [f.level for f in check("La tasa vale 0.5 y w = 3.", 1, {})]
    assert levels == ["warn", "warn"]


def test_too_many_sentences_in_one_beat_warns():
    assert [f.level for f in check("Uno. Dos. Tres. Cuatro.", 1, {})] == ["warn"]
