from pathlib import Path

import pytest
import yaml

from app.services.content import ContentError, DeckContent, parse_deck

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


def test_starter_deck_is_valid(starter_content: DeckContent) -> None:
    assert starter_content.deck.id == "starter"
    assert len(starter_content.deck.words) == 30
    # Every part of speech used needs enough words to supply same-kind distractors.
    by_pos: dict[str, int] = {}
    for entry in starter_content.words:
        by_pos[entry.pos] = by_pos.get(entry.pos, 0) + 1
    assert min(by_pos.values()) >= 4


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
