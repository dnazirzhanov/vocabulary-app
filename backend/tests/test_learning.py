import random

from app.services.learning import (
    NEW_WORDS_PER_SESSION,
    PlannedExercise,
    WordFacts,
    cloze,
    is_typed_answer_correct,
    normalize_answer,
    pick_new_words,
    pick_options,
    plan_new_session,
    plan_practice_session,
)

POOL = [
    WordFacts("house", "house", "noun", "дом"),
    WordFacts("door", "door", "noun", "дверь"),
    WordFacts("city", "city", "noun", "город"),
    WordFacts("book", "book", "noun", "книга"),
    WordFacts("home", "home", "noun", "дом"),  # same translation as "house"
    WordFacts("buy", "buy", "verb", "покупать, купить"),
    WordFacts("wait", "wait", "verb", "ждать"),
    WordFacts("cheap", "cheap", "adjective", "дешёвый"),
    WordFacts("colour", "colour", "noun", "цвет", also_accept=("color",)),
]
BY_ID = {word.id: word for word in POOL}


def test_new_words_follow_deck_order_and_skip_introduced() -> None:
    order = ["house", "door", "city", "book", "buy", "wait", "cheap"]
    assert pick_new_words(order, introduced={"door", "book"}) == [
        "house",
        "city",
        "buy",
        "wait",
        "cheap",
    ]
    assert pick_new_words(order, introduced=set(order)) == []
    assert len(pick_new_words(order, introduced=set())) == NEW_WORDS_PER_SESSION


def test_options_contain_the_answer_once_and_prefer_the_same_part_of_speech() -> None:
    for seed in range(50):
        options = pick_options(BY_ID["house"], POOL, random.Random(seed))
        assert len(options) == 4
        assert options.count("house") == 1
        # "home" shares the translation дом, so it would make two options correct.
        assert "home" not in options
        assert all(BY_ID[option].pos == "noun" for option in options)


def test_options_fall_back_to_other_parts_of_speech_when_needed() -> None:
    options = pick_options(BY_ID["wait"], POOL, random.Random(1))
    assert len(options) == 4
    assert options.count("wait") == 1
    assert "buy" in options  # the only other verb is always used first


def test_answer_position_varies() -> None:
    positions = {
        pick_options(BY_ID["house"], POOL, random.Random(s)).index("house") for s in range(40)
    }
    assert positions == {0, 1, 2, 3}


def test_new_session_plan_shape() -> None:
    words = [BY_ID["house"], BY_ID["buy"], BY_ID["cheap"]]
    plan = plan_new_session(words, POOL, seed="session-1")
    assert [(e.type, e.word_id) for e in plan] == [
        ("introduce", "house"),
        ("choose_meaning", "house"),
        ("introduce", "buy"),
        ("choose_meaning", "buy"),
        ("introduce", "cheap"),
        ("choose_meaning", "cheap"),
        ("type_word", "house"),
        ("type_word", "buy"),
        ("type_word", "cheap"),
    ]
    assert [e.id for e in plan] == [str(n) for n in range(1, 10)]
    assert all(e.options for e in plan if e.type == "choose_meaning")
    assert not any(e.options for e in plan if e.type != "choose_meaning")


def test_plans_are_deterministic_per_seed() -> None:
    words = [BY_ID["house"], BY_ID["door"]]
    assert plan_new_session(words, POOL, "same") == plan_new_session(words, POOL, "same")


def test_practice_plan_skips_introduction() -> None:
    plan = plan_practice_session([BY_ID["door"], BY_ID["wait"]], POOL, seed="p")
    assert [(e.type, e.word_id) for e in plan] == [
        ("choose_meaning", "door"),
        ("choose_meaning", "wait"),
        ("type_word", "door"),
        ("type_word", "wait"),
    ]


def test_plan_survives_a_json_round_trip() -> None:
    plan = plan_new_session([BY_ID["house"]], POOL, seed="x")
    assert [PlannedExercise.from_json(e.to_json()) for e in plan] == plan


def test_normalization_forgives_everything_but_spelling() -> None:
    assert normalize_answer("  House. ") == "house"
    assert normalize_answer("DON’T") == "don't"
    assert normalize_answer("ice   cream!") == "ice cream"
    assert normalize_answer("«book»") == "book"


def test_typed_answers() -> None:
    assert is_typed_answer_correct("House", BY_ID["house"])
    assert is_typed_answer_correct("color", BY_ID["colour"])
    assert not is_typed_answer_correct("hous", BY_ID["house"])
    assert not is_typed_answer_correct("   ", BY_ID["house"])
    assert not is_typed_answer_correct("houses", BY_ID["house"])


def test_cloze_blanks_the_whole_word_only() -> None:
    assert cloze("Please open your books.", "open") == "Please ____ your books."
    assert cloze("The shop opens at nine.", "open") is None
    assert cloze("Key to the car? The key!", "key") == "____ to the car? The key!"
