"""Plain helpers shared by tests (fixtures live in conftest.py)."""

from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient

from app.core.db import get_sessionmaker
from app.models import LearningSession, Word

Ratings = dict[str, int]  # headword → rating for its first showing in a session
Spellings = dict[str, str]  # headword → the word built at its first spelling recall
Play = Callable[..., dict[str, Any]]


def at(moment: datetime, time_zone: str = "UTC") -> dict[str, str]:
    """Headers for a request made at `moment` (development clock) from a learner in `time_zone`."""
    return {"X-Dev-Now": moment.isoformat(), "X-Time-Zone": time_zone}


def named(client: TestClient, headers: dict[str, str], name: str) -> dict[str, str]:
    """Gives the learner of `headers` a name (ADR 0057), which joining a group needs; returns
    the headers, so a request can be sent as them next."""
    assert client.patch("/api/me", json={"name": name}, headers=headers).status_code == 200
    return headers


def rate(rating: int = 3) -> dict[str, object]:
    """A flashcard rating: 1 Снова, 2 Трудно, 3 Хорошо, 4 Легко."""
    return {"kind": "rating", "rating": rating}


def cards(session: dict[str, Any]) -> list[dict[str, Any]]:
    """The flashcards of a session, without its spelling section."""
    return [exercise for exercise in session["exercises"] if exercise["type"] == "card"]


def spell(answer: str) -> dict[str, object]:
    """A word built with letter tiles (ADR 0016)."""
    return {"kind": "spelling", "answer": answer}


def finish(
    client: TestClient,
    session: dict[str, Any],
    headers: dict[str, str],
    ratings: Ratings | None = None,
    spellings: Spellings | None = None,
) -> None:
    """Answers every exercise in order: each card's first showing with its rating in `ratings`
    (default «Хорошо», repeats «Хорошо»); each spelling card as given in `spellings` (default
    built right). A spelling card hides the word, so it is read from the stored plan."""
    exercises = list(session["exercises"])
    seen: set[str] = set()
    index = 0
    while index < len(exercises):
        exercise = exercises[index]
        if exercise["type"] == "card":
            headword = exercise["word"]["headword"]
            rating = (ratings or {}).get(headword, 3) if headword not in seen else 3
            seen.add(headword)
            response = rate(rating)
        else:
            headword = headword_of(session["id"], exercise["id"])
            response = spell((spellings or {}).get(headword, headword))
        result = client.post(
            f"/api/sessions/{session['id']}/attempts",
            json={"exercise_id": exercise["id"], "response": response},
            headers=headers,
        ).json()
        for added in result.get("inserted", []):
            exercises.insert(added["index"], added["exercise"])
        index += 1


def headword_of(session_id: str, exercise_id: str) -> str:
    """The word behind an exercise, read from the stored plan (a recall does not show it)."""
    with get_sessionmaker()() as db:
        session = db.get_one(LearningSession, session_id)
        word_id = next(step["word_id"] for step in session.plan if step["id"] == exercise_id)
        return db.get_one(Word, word_id).headword


def spell_today(
    client: TestClient,
    headers: dict[str, str],
    deck_id: str,
    spellings: Spellings | None = None,
    start: Mapping[str, object] | None = None,
) -> dict[str, Any] | None:
    """Runs a spelling session of the deck (ADR 0016, 0056), the main button's words unless
    `start` asks for another set (ADR 0026); returns the summary, or None when there is nothing
    to spell."""
    started = client.post(
        "/api/sessions",
        json={"kind": "spelling", **(start or {}), "deck_id": deck_id},
        headers=headers,
    )
    if started.status_code == 409:
        return None
    session = started.json()
    finish(client, session, headers, spellings=spellings)
    summary: dict[str, Any] = client.post(
        f"/api/sessions/{session['id']}/complete", headers=headers
    ).json()
    return summary
