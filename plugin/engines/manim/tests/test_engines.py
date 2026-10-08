from explainer.engines import PARAMS, Voice, catalog, house, save_house
from explainer.lint import load_glossary


def test_param_falls_back_to_engine_default():
    voice = Voice("piper", "es_AR-daniela-high", "es")
    assert voice.param("noise_scale") == PARAMS["piper"]["noise_scale"][0]
    tuned = voice.with_param("noise_scale", 0.9)
    assert tuned.param("noise_scale") == 0.9
    assert voice.param("noise_scale") != 0.9


def test_house_voice_round_trips_with_every_param(tmp_path):
    path = tmp_path / "house.toml"
    voice = Voice("kokoro", "af_heart", "en").with_param("speed", 0.95)
    save_house(voice, path)
    loaded = house(path)
    assert (loaded.id, loaded.lang, loaded.param("speed")) == ("kokoro/af_heart", "en", 0.95)


def test_lexicon_language_ignores_region():
    assert Voice("kokoro", "bf_emma", "en-gb").lexicon_lang == "en"


def test_catalog_and_house_files_parse():
    voices = catalog()
    assert {v.engine for v in voices} == {"piper", "kokoro"}
    assert {v.lexicon_lang for v in voices} == {"es", "en"}
    assert house().engine in PARAMS


def test_glossary_is_per_language():
    assert load_glossary("es")["costo"] == "pérdida"
    assert load_glossary("en")["cost"] == "loss"
