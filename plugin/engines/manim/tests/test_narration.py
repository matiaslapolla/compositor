from explainer.narration import (
    AUDIO_OFFSET_RESOLUTION,
    SentenceTiming,
    parse,
    strip_bookmarks,
    word_boundaries,
    word_starts,
)


def seconds(boundary):
    return boundary["audio_offset"] / AUDIO_OFFSET_RESOLUTION


def test_bookmarks_are_removed_without_touching_spacing():
    text = "Mirá <bookmark mark='A'/> la recta."
    assert strip_bookmarks(text) == "Mirá  la recta."


def test_parse_splits_sentences_and_keeps_offsets():
    text = "Hola mundo. ¿Qué tal? Bien"
    sentences = parse(text)
    assert [[w.text for w in s.words] for s in sentences] == [
        ["Hola", "mundo."],
        ["¿Qué", "tal?"],
        ["Bien"],
    ]
    for s in sentences:
        for w in s.words:
            assert text[w.offset : w.offset + len(w.text)] == w.text


def test_lexicon_changes_what_is_spoken_but_not_the_text():
    [sentence] = parse("Usamos la GPU.", {"gpu": "je pe u"})
    gpu = sentence.words[-1]
    assert gpu.text == "GPU."
    assert gpu.spoken == "je pe u."
    assert gpu.spoken_count == 3
    assert sentence.spoken == "Usamos la je pe u."


def test_word_starts_skip_sentence_markers_and_split_on_spaces():
    phonemes = [("^", 0.0), ("l", 1.0), ("a", 1.5), (" ", 2.0), ("r", 2.2), ("e", 2.5), ("$", 2.8)]
    assert word_starts(phonemes) == [1.0, 2.2]


def test_aligned_sentence_uses_piper_times_and_maps_expanded_words_back():
    text = "La GPU calcula."
    sentences = parse(text, {"gpu": "je pe u"})
    # 5 spoken words: la je pe u calcula
    timing = SentenceTiming(start=1.0, duration=2.0, word_starts=[0.0, 0.3, 0.5, 0.7, 1.2])
    b = word_boundaries(text, sentences, [timing], total=3.0)
    assert [x["text"] for x in b] == ["La", "GPU", "calcula.", ""]
    assert [seconds(x) for x in b] == [1.0, 1.3, 2.2, 3.0]
    assert [x["text_offset"] for x in b] == [0, 3, 7, len(text)]


def test_misaligned_sentence_falls_back_to_linear_within_the_sentence():
    text = "Uno dos. Tres cuatro."
    sentences = parse(text)
    timings = [
        SentenceTiming(start=0.0, duration=1.0, word_starts=[0.0, 0.5]),
        SentenceTiming(start=1.5, duration=2.0, word_starts=[0.0]),  # count mismatch
    ]
    b = word_boundaries(text, sentences, timings, total=3.5)
    times = [seconds(x) for x in b]
    assert times[:2] == [0.0, 0.5]
    assert times[2] == 1.5
    assert 1.5 < times[3] < 3.5
    assert times[-1] == 3.5


def test_bare_punctuation_is_not_a_spoken_word():
    [sentence] = parse("Mirá  .")
    assert [w.spoken_count for w in sentence.words] == [1, 0]
