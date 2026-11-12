"""Reading Mode articles (docs/product/reading-mode-architecture.md): every word has its meaning,
and the JSON the app reads is exactly what the YAML builds to."""

from pathlib import Path

import pytest

from app.services import reading
from app.services.content import ContentError, GlossaryEntry, parse_glossary

ROOT = Path(__file__).resolve().parents[2]


def build_repo() -> dict[str, object]:
    return reading.build(
        ROOT / "content" / "reading",
        parse_glossary(ROOT / "content" / "glossary.yaml"),
        reading.course_parts_of_speech(ROOT / "content"),
    )


def test_the_committed_articles_are_what_the_content_builds_to() -> None:
    files = build_repo()
    out = ROOT / "web" / "public" / "reading"
    on_disk = {path.name for path in out.glob("*.json")}
    assert on_disk == set(files), "run: uv run python -m app.cli build-reading"
    for name, data in files.items():
        assert (out / name).read_text(encoding="utf-8") == reading.render(data), name


def test_every_article_is_complete_and_credited() -> None:
    files = build_repo()
    index = files["index.json"]
    assert isinstance(index, dict)
    assert len(index["articles"]) >= 6
    for card in index["articles"]:
        article = files[f"{card['id']}.json"]
        assert isinstance(article, dict)
        assert article["source"]["license"]
        assert article["minutes"] >= 1
        # Three questions with options, then two open ones with sound word limits (round 2).
        questions = article["questions"]
        assert [one["kind"] for one in questions] == ["choice"] * 3 + ["open"] * 2
        assert card["questions"] == 5
        for number, question in enumerate(questions, start=1):
            assert question["id"] == f"library:{card['id']}:{number}"
            if question["kind"] == "choice":
                assert 0 <= question["answer"] < len(question["options"]) <= 4
            else:
                assert 1 <= question["min"] <= question["max"] <= reading.MAX_ANSWER_WORDS
        # The right option is not always in the same place.
        assert len({one["answer"] for one in questions[:3]}) > 1
        # Every word form of the text has a meaning; only names can't become cards.
        for form, entry in article["glossary"].items():
            assert entry["ru"], form
            assert entry["p"] is not None or entry["ru"] == reading.NAME, form


def article(tmp_path: Path, name: str, body: str, extra: str = "") -> Path:
    (tmp_path / f"{name}.yaml").write_text(
        f"id: {name}\ntitle: T\nsubtitle: S\ntopic: nature\nlevel: A2\n"
        "source: {name: Test, license: public domain}\n"
        f"body:\n  - {body}\n  - Second paragraph.\n"
        + "questions:\n"
        + '  - {q: "Which?", options: [a, b, c], answer: b}\n' * 3
        + '  - {q: "Why?", min: 5, max: 50}\n' * 2
        + extra,
        encoding="utf-8",
    )
    return tmp_path


GLOSSARY = {
    "second": GlossaryEntry(ru="второй"),
    "paragraph": GlossaryEntry(ru="абзац"),
    "the": GlossaryEntry(ru="артикль"),
    "bee": GlossaryEntry(ru="пчела"),
}


def test_a_word_without_a_meaning_and_an_unused_entry_are_refused(tmp_path: Path) -> None:
    article(
        tmp_path,
        "a",
        "The hive hums.",
        "glossary:\n  hive: {ru: улей, pos: noun}\n  honey: {ru: мёд, pos: noun}\n",
    )
    with pytest.raises(ContentError) as caught:
        reading.build(tmp_path, GLOSSARY, {})
    assert caught.value.problems == [
        "a.yaml: no meaning for 'hums'",
        "a.yaml: glossary entry 'honey' is not in the text",
    ]


def test_names_possessives_and_course_words(tmp_path: Path) -> None:
    article(
        tmp_path,
        "b",
        "Maya's bee saw the bee's home.",
        "names: [Maya]\n"
        "glossary:\n  saw: {ru: увидела, pos: verb, lemma: see}\n"
        "  home: {ru: дом, pos: noun}\n",
    )
    files = reading.build(tmp_path, GLOSSARY, {"bee": "noun"})
    words = files["b.json"]["glossary"]
    # A name's possessive is still a name: shown as one, never a card.
    assert (words["maya's"]["ru"], words["maya's"]["p"]) == (reading.NAME, None)
    # A possessive is its word, marked; a course word keeps its part of speech.
    assert (words["bee's"]["l"], words["bee's"]["p"]) == ("bee", "noun")
    assert words["bee"]["p"] == "noun"
    assert (words["saw"]["l"], words["saw"]["p"]) == ("see", "verb")
    # A shared word that is not a course word can still become a card.
    assert words["the"]["p"] == "other"


def test_the_shared_glossary_fills_articles_and_refuses_a_repeated_word(tmp_path: Path) -> None:
    article(tmp_path, "c", "The hive.")
    (tmp_path / "_shared.yaml").write_text("hive: {ru: улей, pos: noun}\n", encoding="utf-8")
    files = reading.build(tmp_path, GLOSSARY, {})
    assert files["c.json"]["glossary"]["hive"]["ru"] == "улей"
    (tmp_path / "_shared.yaml").write_text(
        "hive: {ru: улей, pos: noun}\nhive: {ru: пчелиный дом, pos: noun}\n", encoding="utf-8"
    )
    with pytest.raises(ContentError, match="listed twice"):
        reading.build(tmp_path, GLOSSARY, {})


def test_an_article_id_must_match_its_file(tmp_path: Path) -> None:
    article(tmp_path, "d", "The bee.")
    (tmp_path / "d.yaml").rename(tmp_path / "e.yaml")
    with pytest.raises(ContentError, match="must match the file name"):
        reading.build(tmp_path, GLOSSARY, {})
