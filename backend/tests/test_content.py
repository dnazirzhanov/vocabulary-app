from pathlib import Path

import pytest
import yaml

from app.services.content import (
    ContentError,
    DeckContent,
    duplicate_words,
    example_tokens,
    missing_glossary_forms,
    parse_deck,
    parse_glossary,
)

DECK = {
    "id": "tiny",
    "title": "Tiny",
    "description": "Test deck",
    "learning_language": "en",
    "explanation_language": "ru",
    "status": "published",
    "content_version": 1,
    "source": "tests",
    "review_status": "draft",
    "words": ["a", "b", "c", "d"],
}


def word(word_id: str, **overrides: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": word_id,
        "headword": word_id,
        "pos": "noun",
        "translation": f"перевод {word_id}",
        "example": f"This is {word_id} here.",
        "example_ru": "Пример.",
    }
    return entry | overrides


def write_deck(directory: Path, deck: dict[str, object], words: list[dict[str, object]]) -> Path:
    (directory / "deck.yaml").write_text(yaml.safe_dump(deck, allow_unicode=True), "utf-8")
    (directory / "words.yaml").write_text(yaml.safe_dump(words, allow_unicode=True), "utf-8")
    return directory


LEVELS = {"a1-a2": ("A1–A2", 1), "b1-b2": ("B1–B2", 2), "c1": ("C1", 3)}
CONTENT = Path(__file__).resolve().parents[2] / "content"


def test_the_three_levels_have_100_words_each_and_no_word_twice() -> None:
    decks = [parse_deck(CONTENT / level) for level in LEVELS]
    for content in decks:
        assert len(content.deck.words) == 100
        assert (content.deck.level, content.deck.level_order) == LEVELS[content.deck.id]
    assert duplicate_words(decks) == []


def test_valid_tiny_deck(tmp_path: Path) -> None:
    content = parse_deck(write_deck(tmp_path, DECK, [word(i) for i in "abcd"]))
    assert [w.id for w in content.words] == ["a", "b", "c", "d"]


def test_every_problem_is_reported_at_once(tmp_path: Path) -> None:
    words = [
        word("a"),
        word("a"),  # duplicate id
        word("b", example="No headword in this sentence."),
        word("c", illustration="giraffe"),  # unknown illustration
        word("Bad Id"),
        word("e", translation=""),
    ]
    deck = DECK | {"words": ["a", "b", "c", "zzz"]}
    with pytest.raises(ContentError) as error:
        parse_deck(write_deck(tmp_path, deck, words))
    report = "\n".join(error.value.problems)
    assert "duplicate id 'a'" in report
    assert "headword 'b' as a whole word" in report
    assert "[c]" in report and "illustration" in report
    assert "[Bad Id]" in report
    assert "[e]" in report and "translation" in report
    assert "unknown word 'zzz'" in report


def test_unknown_fields_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ContentError, match="transltion"):
        parse_deck(write_deck(tmp_path, DECK, [word("a", transltion="typo")]))


def test_a_course_goal_needs_a_source(tmp_path: Path) -> None:
    goal = {"target_words": 1300, "coverage_percent": 80}
    words = [word(i) for i in "abcd"]
    with pytest.raises(ContentError, match=r"course_goal\.source"):
        parse_deck(write_deck(tmp_path, DECK | {"course_goal": goal}, words))
    sourced = goal | {"source": "NGSL"}
    content = parse_deck(write_deck(tmp_path, DECK | {"course_goal": sourced}, words))
    assert content.deck.course_goal is not None


GLOSSARY = Path(__file__).resolve().parents[2] / "content" / "glossary.yaml"


def test_every_example_word_of_every_level_can_be_tapped() -> None:
    glossary = parse_glossary(GLOSSARY)
    for level in LEVELS:
        assert missing_glossary_forms(parse_deck(CONTENT / level), glossary) == []


def test_a_word_in_two_decks_is_refused(tmp_path: Path) -> None:
    first = parse_deck(write_deck(tmp_path, DECK, [word(i) for i in "abcd"]))
    second = DeckContent(deck=first.deck.model_copy(update={"id": "other"}), words=first.words)
    assert duplicate_words([first, second])[0] == "word 'a' is in both 'tiny' and 'other'"


def test_example_words_keep_contractions_and_accents() -> None:
    assert example_tokens("Don't forget the café, it's here!") == [
        "don't",
        "forget",
        "the",
        "café",
        "it's",
        "here",
    ]


def test_a_missing_or_malformed_glossary_entry_is_reported(tmp_path: Path) -> None:
    # YAML reads a bare `on:` as true; the validator refuses any key that is not a word form.
    (tmp_path / "glossary.yaml").write_text(
        "Bad Key: {ru: x}\nok: {nope: 1}\non: {ru: на}\n", "utf-8"
    )
    with pytest.raises(ContentError) as raised:
        parse_glossary(tmp_path / "glossary.yaml")
    assert len(raised.value.problems) == 4  # bad key, missing ru, unknown field, unquoted `on`
    content = parse_deck(write_deck(tmp_path, DECK, [word(i) for i in "abcd"]))
    assert "no entry for 'this'" in missing_glossary_forms(content, {})[0]
