"""Reading Mode articles (docs/product/reading-mode-architecture.md): YAML in content/reading/,
built into the static JSON the app reads from web/public/reading/. Every word of an article has
its meaning prepared here, so a tap in the reader is a lookup on the device, never a request."""

import json
import math
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

from app.services.content import (
    TOKEN,
    ContentError,
    GlossaryEntry,
    Slug,
    Text,
    example_tokens,
)

Level = Literal["A1", "A2", "B1", "B2", "C1"]
Topic = Literal["science", "technology", "nature", "society", "psychology", "history", "culture"]
Pos = Literal["noun", "verb", "adjective", "adverb", "phrase", "other"]
# Words a minute: slower where learners are still decoding.
READING_SPEED = {"A1": 150, "A2": 170, "B1": 190, "B2": 210, "C1": 230}
HEADING = "## "


class Source(BaseModel):
    """Where the text comes from: shown at the end of the article, as its licence requires."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[Text, StringConstraints(max_length=120)]
    url: Annotated[Text, StringConstraints(max_length=300, pattern=r"^https://")] | None = None
    license: Annotated[Text, StringConstraints(max_length=60)]
    # What we changed: "shortened", "adapted", or nothing when it is as published.
    note: Annotated[Text, StringConstraints(max_length=200)] | None = None


class ArticleWord(BaseModel):
    """One word form of the article's own glossary."""

    model_config = ConfigDict(extra="forbid")

    ru: Annotated[Text, StringConstraints(max_length=120)]
    pos: Pos
    # The dictionary form when the form in the text differs (dances → dance).
    lemma: Annotated[Text, StringConstraints(max_length=64)] | None = None
    # A short learner's explanation in simple English.
    define: Annotated[Text, StringConstraints(max_length=160)] | None = Field(
        default=None, alias="def"
    )


# An answer is at most this many words, whatever a question allows (the owner's limit).
MAX_ANSWER_WORDS = 500


class Question(BaseModel):
    """A question after the text (round 2): with choices, on the text's facts (`options`, and the
    right one as `answer`); or open, answered in writing or by voice within `min`–`max` words."""

    model_config = ConfigDict(extra="forbid")

    q: Annotated[Text, StringConstraints(max_length=300)]
    options: list[Annotated[Text, StringConstraints(max_length=120)]] | None = None
    answer: Annotated[Text, StringConstraints(max_length=120)] | None = None
    min: int | None = Field(default=None, ge=1, le=MAX_ANSWER_WORDS)
    max: int | None = Field(default=None, ge=1, le=MAX_ANSWER_WORDS)

    @property
    def kind(self) -> Literal["choice", "open"]:
        return "choice" if self.options is not None else "open"

    @property
    def right(self) -> int:
        """The right option's place (a choice question)."""
        return (self.options or []).index(self.answer or "")

    @model_validator(mode="after")
    def _whole(self) -> "Question":
        if self.options is not None:
            if self.min is not None or self.max is not None:
                raise ValueError("a question with options has no word limits")
            if not 3 <= len(self.options) <= 4 or len(set(self.options)) != len(self.options):
                raise ValueError("3 or 4 different options")
            if self.answer not in self.options:
                raise ValueError("answer must be one of the options")
        else:
            if self.answer is not None:
                raise ValueError("an open question has no answer")
            if self.min is None or self.max is None:
                raise ValueError("an open question has min and max")
            if self.min > self.max:
                raise ValueError("min must not be above max")
        return self


class Article(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Slug
    title: Annotated[Text, StringConstraints(max_length=120)]
    subtitle: Annotated[Text, StringConstraints(max_length=200)]
    topic: Topic
    level: Level
    source: Source
    # Paragraphs; one starting with "## " is a section heading.
    body: list[Annotated[Text, StringConstraints(max_length=2000)]] = Field(min_length=2)
    glossary: dict[str, ArticleWord] = Field(default_factory=dict)
    # People and places, as written: tapped, they say «имя или название» and can't become cards.
    names: list[Annotated[Text, StringConstraints(max_length=40)]] = Field(default_factory=list)
    # What a reader answers after reading (round 2): three with choices, then two open ones.
    questions: list[Question]

    @model_validator(mode="after")
    def _three_and_two(self) -> "Article":
        kinds = [question.kind for question in self.questions]
        if kinds != ["choice"] * 3 + ["open"] * 2:
            raise ValueError("questions: three with options, then two open ones")
        return self


def question_json(question: Question) -> dict[str, Any]:
    """As the app reads it: a choice question's right option by its place, for an answer on the
    spot (offline too)."""
    if question.kind == "choice":
        return {
            "kind": "choice",
            "q": question.q,
            "options": question.options,
            "answer": question.right,
        }
    return {"kind": "open", "q": question.q, "min": question.min, "max": question.max}


def question_ref(article_id: str, number: int) -> str:
    """How an answer names a library question: `library:<article>:<1-based number>`."""
    return f"library:{article_id}:{number}"


def body_tokens(article: Article) -> list[str]:
    return [token for paragraph in article.body for token in example_tokens(paragraph)]


def _parse(path: Path) -> Article:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ContentError([f"{path.name}: cannot read: {exc}"]) from exc
    try:
        article = Article.model_validate(raw)
    except ValidationError as exc:
        raise ContentError(
            [f"{path.name}: {'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
        ) from exc
    if article.id != path.stem:
        raise ContentError([f"{path.name}: id {article.id!r} must match the file name"])
    return article


def course_parts_of_speech(content_dir: Path) -> dict[str, str]:
    """headword → part of speech of the course's words: a glossary form saved from an article takes
    its course word's part of speech, so the card links to the course card (and keeps progress)."""
    found: dict[str, str] = {}
    for words_file in sorted(content_dir.glob("*/words.yaml")):
        for word in yaml.safe_load(words_file.read_text(encoding="utf-8")) or []:
            found.setdefault(str(word["headword"]).lower(), str(word["pos"]))
    return found


NAME = "имя или название"


SHARED = "_shared.yaml"


def parse_shared(reading_dir: Path) -> dict[str, ArticleWord]:
    """Meanings common to many articles (content/reading/_shared.yaml), so each article lists only
    its own words, or a meaning special to its text."""
    path = reading_dir / SHARED
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    raw = yaml.safe_load(text) or {}
    problems: list[str] = []
    # YAML keeps the last of two equal keys without a word: a meaning would vanish unseen.
    keys = [line.split(":", 1)[0] for line in text.splitlines() if line and line[0].isalpha()]
    problems += [
        f"{SHARED}: {key!r} is listed twice" for key in sorted(set(keys)) if keys.count(key) > 1
    ]
    shared: dict[str, ArticleWord] = {}
    for form, value in raw.items():
        if form != form.lower() or not TOKEN.fullmatch(form):
            problems.append(f"{SHARED}: key {form!r} must be one lowercase form")
            continue
        try:
            shared[form] = ArticleWord.model_validate(value)
        except ValidationError as exc:
            problems += [f"{SHARED} [{form}]: {e['msg']}" for e in exc.errors()]
    if problems:
        raise ContentError(problems)
    return shared


def _entry(
    form: str,
    article: Article,
    shared: dict[str, ArticleWord],
    glossary: dict[str, GlossaryEntry],
    course_pos: dict[str, str],
    names: set[str],
) -> dict[str, Any] | None:
    if form in names:
        return {"l": form, "p": None, "ru": NAME, "d": None}
    known = form in article.glossary or form in shared or form in glossary
    if form.endswith("'s") and not known:
        # A possessive (world's): the word itself, marked.
        base = _entry(form[:-2], article, shared, glossary, course_pos, names)
        if base is not None:
            return {**base, "d": "'s: чей-то (притяжательная форма)"}
    own = article.glossary.get(form) or shared.get(form)
    if own is not None:
        return {"l": own.lemma or form, "p": own.pos, "ru": own.ru, "d": own.define}
    course = glossary.get(form)
    if course is None:
        return None
    lemma = course.lemma or form
    # A course word keeps its part of speech (so a saved card links to it); others are "other".
    return {"l": lemma, "p": course_pos.get(lemma, "other"), "ru": course.ru, "d": course.note}


def build(
    reading_dir: Path, glossary: dict[str, GlossaryEntry], course_pos: dict[str, str]
) -> dict[str, Any]:
    """{"index.json": …, "<id>.json": …}: what the app reads. Raises ContentError listing every
    problem: a word with no meaning, an unused glossary entry, a bad field."""
    files: dict[str, Any] = {}
    index: list[dict[str, Any]] = []
    problems: list[str] = []
    shared = parse_shared(reading_dir)
    for path in sorted(reading_dir.glob("[!_]*.yaml")):
        try:
            article = _parse(path)
        except ContentError as error:
            problems += error.problems
            continue
        tokens = body_tokens(article)
        names = {token for name in article.names for token in example_tokens(name)}
        words: dict[str, Any] = {}
        for form in dict.fromkeys(tokens):
            entry = _entry(form, article, shared, glossary, course_pos, names)
            if entry is None:
                problems.append(f"{path.name}: no meaning for {form!r}")
            else:
                words[form] = entry
        for form in article.glossary:
            if form != form.lower() or not TOKEN.fullmatch(form):
                problems.append(f"{path.name}: glossary key {form!r} must be one lowercase form")
            elif form not in words:
                problems.append(f"{path.name}: glossary entry {form!r} is not in the text")
        minutes = max(1, math.ceil(len(tokens) / READING_SPEED[article.level]))
        card = {
            "id": article.id,
            "title": article.title,
            "subtitle": article.subtitle,
            "topic": article.topic,
            "level": article.level,
            "minutes": minutes,
            # How many questions it asks: the library's row says how many are answered.
            "questions": len(article.questions),
        }
        index.append(card)
        files[f"{article.id}.json"] = {
            **card,
            "words": len(tokens),
            "source": article.source.model_dump(exclude_none=True),
            "body": article.body,
            "glossary": words,
            "questions": [
                {"id": question_ref(article.id, n), **question_json(one)}
                for n, one in enumerate(article.questions, start=1)
            ],
        }
    if problems:
        raise ContentError(problems)
    order = list(READING_SPEED)
    index.sort(key=lambda card: (order.index(card["level"]), card["title"]))
    files["index.json"] = {"articles": index}
    return files


def render(data: Any) -> str:
    """The exact bytes written: compact and stable, so a check can compare them."""
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def write(files: dict[str, Any], out_dir: Path) -> list[str]:
    """Writes the built files and removes ones no longer built; returns the names written."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        if stale.name not in files:
            stale.unlink()
    for name, data in files.items():
        (out_dir / name).write_text(render(data), encoding="utf-8")
    return sorted(files)


def reading_dir() -> Path:
    """content/reading/: beside the backend in the image (/app/content), above it in the repo."""
    here = Path(__file__).resolve().parents[2]
    for base in (here / "content", here.parent / "content"):
        if (base / "reading").is_dir():
            return base / "reading"
    raise FileNotFoundError("content/reading/ not found")


@cache
def library_questions() -> dict[str, tuple[str, Question]]:
    """Every library question by its ref, with its article's ref: what an answer is checked
    against. Read once; the articles change only with a deploy."""
    found: dict[str, tuple[str, Question]] = {}
    for path in sorted(reading_dir().glob("[!_]*.yaml")):
        article = _parse(path)
        for n, one in enumerate(article.questions, start=1):
            found[question_ref(article.id, n)] = (f"library:{article.id}", one)
    return found
