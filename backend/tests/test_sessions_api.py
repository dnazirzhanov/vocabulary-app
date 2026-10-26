from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, User, UserWordProgress
from app.services.content import DeckContent

START_NEW = {"kind": "new", "deck_id": "starter"}
OTHER_USER = {"X-Dev-User": "other"}


@pytest.fixture
def answers(starter_content: DeckContent) -> dict[str, dict[str, str]]:
    return {
        "translation_of": {w.headword: w.translation for w in starter_content.words},
        "headword_for": {w.translation: w.headword for w in starter_content.words},
    }


def response_for(
    exercise: dict[str, Any], answers: dict[str, dict[str, str]], correct: bool = True
) -> dict[str, str]:
    """What a learner would send; the test knows the content, the API payload does not reveal it."""
    if exercise["type"] == "introduce":
        return {"kind": "seen"}
    if exercise["type"] == "choose_meaning":
        right = answers["translation_of"][exercise["word"]["headword"]]
        option = next(o for o in exercise["options"] if (o["label"] == right) == correct)
        return {"kind": "choice", "option_id": option["id"]}
    headword = answers["headword_for"][exercise["prompt"]["translation"]]
    return {"kind": "text", "text": headword.upper() + " " if correct else headword + "x"}


def attempt(
    client: TestClient, session_id: str, exercise: dict[str, Any], response: dict[str, str]
) -> Any:
    return client.post(
        f"/api/sessions/{session_id}/attempts",
        json={"exercise_id": exercise["id"], "response": response},
    )


def test_a_learner_completes_a_session_and_progress_persists(
    client: TestClient, answers: dict[str, dict[str, str]]
) -> None:
    decks = client.get("/api/decks").json()
    assert decks == [
        {
            "id": "starter",
            "title": "Первые слова",
            "description": decks[0]["description"],
            "word_count": 30,
            "introduced_count": 0,
        }
    ]

    session = client.post("/api/sessions", json=START_NEW).json()
    exercises = session["exercises"]
    assert [e["type"] for e in exercises] == ["introduce", "choose_meaning"] * 5 + ["type_word"] * 5
    assert session["results"] == [] and session["completed"] is False

    for exercise in exercises:
        result = attempt(client, session["id"], exercise, response_for(exercise, answers))
        assert result.status_code == 200
        assert result.json()["correct"] is (None if exercise["type"] == "introduce" else True)

    summary = client.post(f"/api/sessions/{session['id']}/complete").json()
    assert [w["word"]["headword"] for w in summary["words"]] == [
        "house",
        "water",
        "friend",
        "buy",
        "cheap",
    ]
    assert all(w["mistakes"] == 0 for w in summary["words"])
    assert (summary["answers_total"], summary["answers_correct"]) == (10, 10)

    # A "refresh": nothing is held client-side, the server still knows.
    assert client.get("/api/sessions/active").json() == {"session": None}
    assert client.get("/api/decks").json()[0]["introduced_count"] == 5

    # The next session continues with the next words in deck order.
    following = client.post("/api/sessions", json=START_NEW).json()
    assert following["exercises"][0]["word"]["headword"] == "money"


def test_payloads_do_not_reveal_answers_before_answering(client: TestClient) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    choose = next(e for e in session["exercises"] if e["type"] == "choose_meaning")
    typing = next(e for e in session["exercises"] if e["type"] == "type_word")
    assert set(choose["word"]) == {"headword", "pos", "example"}  # no translation, no picture
    assert "house" not in str(typing)  # the typed word appears nowhere in its prompt
    assert typing["prompt"]["cloze"] == "They live in a small ____ near the river."


def test_a_repeated_submission_counts_once(
    client: TestClient, db: Session, answers: dict[str, dict[str, str]]
) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    intro, choose = session["exercises"][:2]
    attempt(client, session["id"], intro, {"kind": "seen"})

    first = attempt(client, session["id"], choose, response_for(choose, answers, correct=False))
    retry = attempt(client, session["id"], choose, response_for(choose, answers, correct=True))
    assert first.json() == retry.json()
    assert first.json()["correct"] is False

    progress = db.scalars(select(UserWordProgress)).one()
    assert (progress.correct_count, progress.incorrect_count) == (0, 1)


def test_an_unfinished_session_resumes(
    client: TestClient, answers: dict[str, dict[str, str]]
) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    for exercise in session["exercises"][:3]:
        attempt(client, session["id"], exercise, response_for(exercise, answers))

    active = client.get("/api/sessions/active").json()["session"]
    assert active["id"] == session["id"]
    assert [r["exercise_id"] for r in active["results"]] == ["1", "2", "3"]
    # Starting again (double tap, second device) returns the same session.
    assert client.post("/api/sessions", json=START_NEW).json()["id"] == session["id"]


def test_mistakes_are_summarised_and_can_be_practised(
    client: TestClient, answers: dict[str, dict[str, str]]
) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    wrong = {"2", "12"}  # choose_meaning for "house" (2), type_word for "water" (11-15 type)
    for exercise in session["exercises"]:
        response = response_for(exercise, answers, correct=exercise["id"] not in wrong)
        result = attempt(client, session["id"], exercise, response).json()
        if exercise["id"] in wrong:
            assert result["correct"] is False
            assert result["answer"]["headword"] in {"house", "water"}

    summary = client.post(f"/api/sessions/{session['id']}/complete").json()
    mistakes = {w["word"]["headword"]: w["mistakes"] for w in summary["words"]}
    assert mistakes == {"house": 1, "water": 1, "friend": 0, "buy": 0, "cheap": 0}
    assert (summary["answers_total"], summary["answers_correct"]) == (10, 8)

    practice = client.post(
        "/api/sessions", json={"kind": "practice", "source_session_id": session["id"]}
    ).json()
    assert practice["kind"] == "practice"
    assert [(e["type"], e.get("word", {}).get("headword")) for e in practice["exercises"]] == [
        ("choose_meaning", "house"),
        ("choose_meaning", "water"),
        ("type_word", None),
        ("type_word", None),
    ]


def test_another_learner_cannot_read_or_change_a_session(
    client: TestClient, answers: dict[str, dict[str, str]]
) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    first = session["exercises"][0]
    path = f"/api/sessions/{session['id']}"

    assert client.get(path, headers=OTHER_USER).status_code == 404
    denied = client.post(
        f"{path}/attempts",
        json={"exercise_id": first["id"], "response": {"kind": "seen"}},
        headers=OTHER_USER,
    )
    assert denied.status_code == 404
    assert denied.json()["error"]["code"] == "session_not_found"
    assert client.post(f"{path}/complete", headers=OTHER_USER).status_code == 404
    assert client.get("/api/sessions/active", headers=OTHER_USER).json() == {"session": None}
    practice = {"kind": "practice", "source_session_id": session["id"]}
    assert client.post("/api/sessions", json=practice, headers=OTHER_USER).status_code == 404

    # The owner's session is untouched.
    assert client.get(path).json()["results"] == []


def test_invalid_attempts_are_rejected(
    client: TestClient, answers: dict[str, dict[str, str]]
) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    intro, choose, third = session["exercises"][:3]

    skipped = attempt(client, session["id"], third, {"kind": "seen"})
    assert (skipped.status_code, skipped.json()["error"]["code"]) == (409, "out_of_order")

    wrong_kind = attempt(client, session["id"], intro, {"kind": "text", "text": "house"})
    assert (wrong_kind.status_code, wrong_kind.json()["error"]["code"]) == (422, "invalid_response")

    attempt(client, session["id"], intro, {"kind": "seen"})
    bogus = attempt(client, session["id"], choose, {"kind": "choice", "option_id": "giraffe"})
    assert (bogus.status_code, bogus.json()["error"]["code"]) == (422, "invalid_option")

    too_long = attempt(client, session["id"], choose, {"kind": "text", "text": "x" * 101})
    assert (too_long.status_code, too_long.json()["error"]["code"]) == (422, "invalid_request")

    unknown = attempt(client, session["id"], {"id": "99"}, {"kind": "seen"})
    assert unknown.status_code == 404


def test_completion_rules(client: TestClient, answers: dict[str, dict[str, str]]) -> None:
    session = client.post("/api/sessions", json=START_NEW).json()
    early = client.post(f"/api/sessions/{session['id']}/complete")
    assert (early.status_code, early.json()["error"]["code"]) == (409, "session_incomplete")

    for exercise in session["exercises"]:
        attempt(client, session["id"], exercise, response_for(exercise, answers))
    first = client.post(f"/api/sessions/{session['id']}/complete").json()
    assert client.post(f"/api/sessions/{session['id']}/complete").json() == first

    late = attempt(client, session["id"], session["exercises"][0], {"kind": "seen"})
    assert late.status_code == 200  # replay of a stored answer, not a new one

    practice = {"kind": "practice", "source_session_id": session["id"]}
    nothing = client.post("/api/sessions", json=practice)
    assert (nothing.status_code, nothing.json()["error"]["code"]) == (409, "nothing_to_practice")


def test_a_finished_deck_offers_no_new_session(client: TestClient, db: Session) -> None:
    client.get("/api/decks")  # creates the development user
    user = db.scalars(select(User)).one()
    now = datetime.now(UTC)
    for word_id in db.scalars(select(DeckWord.word_id).where(DeckWord.deck_id == "starter")):
        db.add(
            UserWordProgress(user_id=user.id, word_id=word_id, introduced_at=now, last_seen_at=now)
        )
    db.commit()

    response = client.post("/api/sessions", json=START_NEW)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "deck_complete")


def test_unknown_deck_and_bad_dev_user(client: TestClient) -> None:
    missing = client.post("/api/sessions", json={"kind": "new", "deck_id": "nope"})
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "deck_not_found")
    bad = client.get("/api/decks", headers={"X-Dev-User": "Robert'); DROP TABLE users;--"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "invalid_dev_user")
