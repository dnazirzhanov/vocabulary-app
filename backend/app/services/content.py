"""Starter-deck content: parse and validate YAML, then import it into the database (ADR 0005)."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Deck, DeckWord, GlossaryForm, Word

# Must match the registry in web/src/illustrations/index.tsx.
ILLUSTRATIONS = ("umbrella", "kettle", "lighthouse", "backpack", "key")

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class WordEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug
    headword: Annotated[Text, StringConstraints(max_length=64)]
    pos: Literal["noun", "verb", "adjective", "adverb"]
    translation: Annotated[Text, StringConstraints(max_length=120)]
    also_accept: list[Annotated[Text, StringConstraints(max_length=64)]] = Field(
        default_factory=list
    )
    example: Annotated[Text, StringConstraints(max_length=300)]
    example_ru: Annotated[Text, StringConstraints(max_length=300)]
    illustration: Literal[ILLUSTRATIONS] | None = None  # type: ignore[valid-type]

    @model_validator(mode="after")
    def _example_uses_headword(self) -> "WordEntry":
        # The typing exercise blanks the headword out of the example, so it must appear verbatim.
        if not headword_pattern(self.headword).search(self.example):
            raise ValueError(f"example must contain the headword {self.headword!r} as a whole word")
        return self


class CourseGoal(BaseModel):
    """The promise shown to learners. Every number needs a source, so a claim is never invented."""

    model_config = ConfigDict(extra="forbid")

    target_words: int = Field(ge=1, le=10_000)
    coverage_percent: int = Field(ge=1, le=100)
    source: Annotated[Text, StringConstraints(max_length=300)]


class DeckEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug
    title: Annotated[Text, StringConstraints(max_length=120)]
    description: Text
    learning_language: Literal["en"]
    explanation_language: Literal["ru"]
    status: Literal["draft", "published"]
    content_version: int = Field(ge=1)
    source: Text
    review_status: Literal["draft", "reviewed"]
    course_goal: CourseGoal | None = None
    words: list[Slug] = Field(min_length=4)


class GlossaryEntry(BaseModel):
    """The meaning of one word form used in example sentences (content/glossary.yaml)."""

    model_config = ConfigDict(extra="forbid")

    ru: Annotated[Text, StringConstraints(max_length=200)]
    lemma: Annotated[Text, StringConstraints(max_length=64)] | None = None
    note: Annotated[Text, StringConstraints(max_length=120)] | None = None


# A word in an example sentence: letters (with accents, as in café) and an optional apostrophe part
# (don't, it's). Must match web/src/lib/tokens.ts.
TOKEN = re.compile(r"[A-Za-zÀ-ÿ]+(?:'[A-Za-zÀ-ÿ]+)?")


def example_tokens(text: str) -> list[str]:
    return [match.group(0).lower() for match in TOKEN.finditer(text)]


class ContentError(Exception):
    """All problems found in a deck, so a reviewer can fix them in one pass."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class DeckContent:
    deck: DeckEntry
    words: list[WordEntry]


def headword_pattern(headword: str) -> re.Pattern[str]:
    return re.compile(rf"\b{re.escape(headword)}\b", re.IGNORECASE)


def _describe(error: ValidationError, where: str) -> list[str]:
    return [
        f"{where}: {'.'.join(str(part) for part in err['loc']) or 'entry'}: {err['msg']}"
        for err in error.errors()
    ]


def parse_deck(directory: Path) -> DeckContent:
    """Parse and validate deck.yaml + words.yaml. Raises ContentError listing every problem."""
    problems: list[str] = []
    try:
        raw_deck = yaml.safe_load((directory / "deck.yaml").read_text(encoding="utf-8"))
        raw_words = yaml.safe_load((directory / "words.yaml").read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ContentError([f"cannot read deck files: {exc}"]) from exc

    deck: DeckEntry | None = None
    try:
        deck = DeckEntry.model_validate(raw_deck)
    except ValidationError as exc:
        problems += _describe(exc, "deck.yaml")

    words: list[WordEntry] = []
    if not isinstance(raw_words, list):
        problems.append("words.yaml: must be a list of word entries")
        raw_words = []
    for index, raw in enumerate(raw_words, start=1):
        label = raw.get("id", f"entry {index}") if isinstance(raw, dict) else f"entry {index}"
        try:
            words.append(WordEntry.model_validate(raw))
        except ValidationError as exc:
            problems += _describe(exc, f"words.yaml [{label}]")

    seen: set[str] = set()
    for word in words:
        if word.id in seen:
            problems.append(f"words.yaml: duplicate id {word.id!r}")
        seen.add(word.id)

    if deck is not None:
        if len(set(deck.words)) != len(deck.words):
            problems.append("deck.yaml: a word is listed more than once")
        missing = [word_id for word_id in deck.words if word_id not in seen]
        problems += [f"deck.yaml: unknown word {word_id!r}" for word_id in missing]

    if problems or deck is None:
        raise ContentError(problems)
    return DeckContent(deck=deck, words=words)


@dataclass(frozen=True)
class ImportStats:
    words: int
    deck_words: int


def import_deck(db: Session, content: DeckContent) -> ImportStats:
    """Upsert words and the deck, replace the deck's word order. One transaction; safe to re-run."""
    for word in content.words:
        values = word.model_dump()
        db.execute(
            insert(Word)
            .values(**values)
            .on_conflict_do_update(
                index_elements=[Word.id], set_={k: v for k, v in values.items() if k != "id"}
            )
        )

    deck_values = content.deck.model_dump(
        exclude={"words", "source", "review_status", "course_goal"}
    )
    goal = content.deck.course_goal
    deck_values["goal_words"] = goal.target_words if goal else None
    deck_values["goal_coverage_percent"] = goal.coverage_percent if goal else None
    db.execute(
        insert(Deck)
        .values(**deck_values)
        .on_conflict_do_update(
            index_elements=[Deck.id], set_={k: v for k, v in deck_values.items() if k != "id"}
        )
    )
    db.execute(delete(DeckWord).where(DeckWord.deck_id == content.deck.id))
    db.add_all(
        DeckWord(deck_id=content.deck.id, word_id=word_id, position=position)
        for position, word_id in enumerate(content.deck.words)
    )
    db.commit()
    return ImportStats(words=len(content.words), deck_words=len(content.deck.words))


def parse_glossary(path: Path) -> dict[str, GlossaryEntry]:
    """Parse and validate the glossary. Raises ContentError listing every problem."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ContentError([f"cannot read glossary: {exc}"]) from exc
    if not isinstance(raw, dict):
        raise ContentError(["glossary.yaml: must map word forms to entries"])
    entries: dict[str, GlossaryEntry] = {}
    problems: list[str] = []
    for form, value in raw.items():
        key = str(form)
        if key != key.lower() or not TOKEN.fullmatch(key):
            problems.append(f"glossary.yaml: {key!r} must be one lowercase word form")
            continue
        try:
            entries[key] = GlossaryEntry.model_validate(value)
        except ValidationError as exc:
            problems += _describe(exc, f"glossary.yaml [{key}]")
    if problems:
        raise ContentError(problems)
    return entries


def missing_glossary_forms(content: DeckContent, glossary: dict[str, GlossaryEntry]) -> list[str]:
    """Problems for every example word with no glossary entry: each word must be tappable."""
    problems = []
    for word in content.words:
        for token in dict.fromkeys(example_tokens(word.example)):
            if token not in glossary:
                problems.append(f"glossary.yaml: no entry for {token!r} (example of {word.id!r})")
    return problems


def import_glossary(db: Session, glossary: dict[str, GlossaryEntry]) -> int:
    """Replace the glossary table with the file's entries. One transaction; safe to re-run."""
    db.execute(delete(GlossaryForm))
    db.add_all(
        GlossaryForm(form=form, ru=entry.ru, lemma=entry.lemma, note=entry.note)
        for form, entry in glossary.items()
    )
    db.commit()
    return len(glossary)
