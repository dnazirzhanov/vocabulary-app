"""Plain helpers shared by tests (fixtures live in conftest.py)."""

from collections.abc import Callable
from datetime import datetime
from typing import Any

Answers = dict[str, dict[str, str]]
Play = Callable[..., dict[str, Any]]


def at(moment: datetime, time_zone: str = "UTC") -> dict[str, str]:
    """Headers for a request made at `moment` (development clock) from a learner in `time_zone`."""
    return {"X-Dev-Now": moment.isoformat(), "X-Time-Zone": time_zone}


def respond(exercise: dict[str, Any], answers: Answers, correct: bool) -> dict[str, str]:
    """What a learner would send; tests know the content, API payloads do not reveal answers."""
    if exercise["type"] == "introduce":
        return {"kind": "seen"}
    if exercise["type"] in ("choose_meaning", "recall_meaning"):
        right = answers["translation_of"][exercise["word"]["headword"]]
        option = next(o for o in exercise["options"] if (o["label"] == right) == correct)
        return {"kind": "choice", "option_id": option["id"]}
    headword = answers["headword_for"][exercise["prompt"]["translation"]]
    return {"kind": "text", "text": headword if correct else headword + "x"}
