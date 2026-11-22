"""What the evaluator may return, and the checks that keep a model's mistakes from the learner.

The model's JSON is never shown as it came: it is parsed against these types, then `clean` drops
anything that cannot be true of the answer (a "mistake" quoting words the learner never wrote)."""

import re
import statistics
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Discriminator, Field, StringConstraints, Tag

Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1500)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)]

CriterionName = Literal["task", "organization", "vocabulary", "grammar", "mechanics"]
CRITERIA: tuple[CriterionName, ...] = ("task", "organization", "vocabulary", "grammar", "mechanics")
CefrLevel = Literal["A1", "A2", "B1", "B2", "C1", "C2"]
MistakeType = Literal["grammar", "spelling", "punctuation", "word_choice"]


def _first(limit: int) -> BeforeValidator:
    """Keep the first `limit` items: one too many from the model must not fail the answer."""

    def cut(value: object) -> object:
        return value[:limit] if isinstance(value, list) else value

    return BeforeValidator(cut)


def _level(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


def _mistake_type(value: object) -> object:
    known = ("grammar", "spelling", "punctuation", "word_choice")
    if isinstance(value, str):
        value = value.strip().lower().replace(" ", "_")
        return value if value in known else "grammar"
    return value


class Criterion(BaseModel):
    score: int = Field(ge=1, le=5)
    comment: Short


class Strength(BaseModel):
    point: Short
    quote: Short | None = None


class Mistake(BaseModel):
    original: Short
    corrected: Short
    explanation: Short
    type: Annotated[MistakeType, BeforeValidator(_mistake_type)] = "grammar"


class VocabularyTip(BaseModel):
    original: Short
    suggestion: Short
    note: Short = ""


class Criteria(BaseModel):
    task: Criterion
    organization: Criterion
    vocabulary: Criterion
    grammar: Criterion
    mechanics: Criterion


class ModelEvaluation(BaseModel):
    """The model's answer, as asked for in prompt.py."""

    enough_evidence: bool
    cefr_level: Annotated[CefrLevel | None, BeforeValidator(_level)] = None
    criteria: Criteria | None = None
    summary: Text
    strengths: Annotated[list[Strength], _first(4)] = Field(default_factory=list)
    improvements: Annotated[list[Short], _first(4)] = Field(default_factory=list)
    corrections: Annotated[list[Mistake], _first(12)] = Field(default_factory=list)
    vocabulary: Annotated[list[VocabularyTip], _first(5)] = Field(default_factory=list)


class Evaluation(ModelEvaluation):
    """What is stored and shown: the model's evaluation after `clean`, plus the overall score.
    The general 1–5 rubric of ADR 0068: answers marked before IELTS (ADR 0081) keep it."""

    rubric: Literal["general"] = "general"
    overall: int | None = Field(default=None, ge=1, le=5)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("’", "'").replace("‘", "'")).strip().lower()


def _contains(answer: str, quote: str) -> bool:
    return bool(_norm(quote)) and _norm(quote) in _norm(answer)


def overall_score(criteria: Criteria) -> int:
    """The mean of the five criteria, rounded half up: the same marks always give the same score."""
    marks = [getattr(criteria, name).score for name in CRITERIA]
    return int(statistics.fmean(marks) + 0.5)


def clean(raw: ModelEvaluation, answer: str) -> Evaluation:
    """Keep only what can be true. Raises ValueError if nothing usable is left."""
    data = raw.model_dump()
    if not raw.enough_evidence or raw.criteria is None:
        # Too little to judge: say so, and show no marks or "mistakes" built on nothing.
        return Evaluation(
            enough_evidence=False,
            summary=raw.summary or "The answer is too short to assess.",
            improvements=raw.improvements[:3],
        )
    data["corrections"] = [
        c.model_dump()
        for c in raw.corrections
        if _contains(answer, c.original) and _norm(c.original) != _norm(c.corrected)
    ]
    data["strengths"] = [
        {"point": s.point, "quote": s.quote if s.quote and _contains(answer, s.quote) else None}
        for s in raw.strengths
    ]
    data["vocabulary"] = [v.model_dump() for v in raw.vocabulary if _contains(answer, v.original)]
    return Evaluation(**data, overall=overall_score(raw.criteria))


# --- IELTS Task 2 (ADR 0081) ----------------------------------------------------------------

IeltsCriterionName = Literal[
    "task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"
]
IELTS_CRITERIA: tuple[IeltsCriterionName, ...] = (
    "task_response",
    "coherence_cohesion",
    "lexical_resource",
    "grammatical_range_accuracy",
)
# Below this, the exam itself would mark Task Response down; here it is only said (the owner's
# choice: IELTS marking, flexible length).
IELTS_TASK2_WORDS = 250


class IeltsCriterion(BaseModel):
    band: int = Field(ge=0, le=9)
    # Why this band, quoting the answer: one sentence.
    why: Short
    # The one change that would lift this criterion a band: one sentence.
    next_band: Short = ""


class IeltsCriteria(BaseModel):
    task_response: IeltsCriterion
    coherence_cohesion: IeltsCriterion
    lexical_resource: IeltsCriterion
    grammatical_range_accuracy: IeltsCriterion


class IeltsModelEvaluation(BaseModel):
    """The model's answer, as asked for in prompt.py."""

    enough_evidence: bool
    criteria: IeltsCriteria | None = None
    summary: Text
    corrections: Annotated[list[Mistake], _first(12)] = Field(default_factory=list)
    upgrades: Annotated[list[VocabularyTip], _first(4)] = Field(default_factory=list)


class IeltsEvaluation(IeltsModelEvaluation):
    """What is stored and shown: the model's evaluation after `clean_ielts`, the overall band the
    backend computes, and the length note the backend writes."""

    rubric: Literal["ielts"] = "ielts"
    band: float | None = Field(default=None, ge=0, le=9)
    words: int = 0


def overall_band(criteria: IeltsCriteria) -> float:
    """IELTS rounding of the four criteria's mean: .25 rounds up to .5, .75 up to the next band."""
    mean = statistics.fmean(getattr(criteria, name).band for name in IELTS_CRITERIA)
    whole, part = divmod(mean, 1)
    if part < 0.25:
        return whole
    if part < 0.75:
        return whole + 0.5
    return whole + 1


def clean_ielts(raw: IeltsModelEvaluation, answer: str) -> IeltsEvaluation:
    """Keep only what can be true of the answer, and add what the backend decides itself."""
    words = len(answer.split())
    if not raw.enough_evidence or raw.criteria is None:
        return IeltsEvaluation(
            enough_evidence=False,
            summary=raw.summary or "The answer is too short to assess.",
            words=words,
        )
    data = raw.model_dump()
    data["corrections"] = [
        c.model_dump()
        for c in raw.corrections
        if _contains(answer, c.original) and _norm(c.original) != _norm(c.corrected)
    ]
    data["upgrades"] = [
        u.model_dump()
        for u in raw.upgrades
        if _contains(answer, u.original) and _norm(u.original) != _norm(u.suggestion)
    ]
    return IeltsEvaluation(**data, band=overall_band(raw.criteria), words=words)


def _rubric_of(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("rubric") or "general")
    return str(getattr(value, "rubric", "general"))


# Either rubric, told apart by `rubric` (stored general evaluations have none).
AnyEvaluation = Annotated[
    Annotated[IeltsEvaluation, Tag("ielts")] | Annotated[Evaluation, Tag("general")],
    Discriminator(_rubric_of),
]
