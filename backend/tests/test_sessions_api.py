"""Flashcard sessions through the API (ADR 0012): show, rate, see forgotten cards again, finish;
reviews come back when FSRS schedules them; practice leaves the schedule alone."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, User, UserWordProgress
from tests.support import Play, at, cards, rate

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
STUDY = {"kind": "study", "deck_id": "a1-a2"}
HARD = {"kind": "hard", "deck_id": "a1-a2"}
OTHER_USER = {"X-Dev-User": "other"}


def start(client: TestClient, moment: datetime = DAY0, body: dict[str, str] = STUDY) -> Any:
    return client.post("/api/sessions", json=body, headers=at(moment))


def rate_card(
    client: TestClient, session_id: str, exercise_id: str, rating: int, moment: datetime = DAY0
) -> Any:
    return client.post(
        f"/api/sessions/{session_id}/attempts",
        json={"exercise_id": exercise_id, "response": rate(rating)},
        headers=at(moment),
    )


def order(client: TestClient, session_id: str) -> list[str]:
    session = client.get(f"/api/sessions/{session_id}", headers=at(DAY0)).json()
    return [card["word"]["headword"] for card in cards(session)]


def test_a_first_session_shows_new_cards_with_their_answer_and_interval_hints(
    client: TestClient,
) -> None:
    decks = client.get("/api/decks").json()
    assert [(d["id"], d["level"], d["word_count"], d["locked"]) for d in decks] == [
        ("a1-a2", "A1–A2", 100, False),
        ("b1-b2", "B1–B2", 100, True),
        ("c1", "C1", 100, True),
    ]

    session = start(client).json()
    assert (session["kind"], session["completed"], session["results"]) == ("study", False, [])
    shown = cards(session)
    assert [card["word"]["headword"] for card in shown] == [
        "house",
        "water",
        "friend",
        "buy",
        "cheap",
    ]
    first = shown[0]
    assert (first["type"], first["new"], first["word"]["translation"]) == ("card", True, "дом")
    # «Снова» brings it back in a minute, «Легко» in days, as Anki shows under its buttons.
    seconds = {preview["rating"]: preview["seconds"] for preview in first["previews"]}
    assert seconds[1] == 60 and seconds[3] == 600 and seconds[4] > 86_400


def test_a_card_rated_good_on_first_sight_comes_back_once_more(
    client: TestClient, db: Session
) -> None:
    session = start(client).json()
    result = rate_card(client, session["id"], "c1", 3).json()
    assert result["rating"] == 3
    [again] = result["inserted"]
    assert again["exercise"]["word"]["headword"] == "house"
    assert (again["exercise"]["new"], again["index"]) == (False, 4)
    # Inserted a few cards later, not at once.
    assert order(client, session["id"]) == ["house", "water", "friend", "buy", "house", "cheap"]

    progress = db.scalars(select(UserWordProgress)).one()
    assert (progress.word_id, progress.fsrs_state, progress.fsrs_step) == ("house", 1, 1)


def test_a_whole_session_teaches_five_words_and_schedules_them_for_a_later_day(
    client: TestClient, play: Play
) -> None:
    summary = play(STUDY, DAY0, ratings={"water": 4, "friend": 1})
    assert (summary["new_words"], summary["reviewed_words"]) == (5, 0)
    # Five new words, nothing extra (ADR 0015); no reviews were due, so the day is kept (ADR 0022);
    # spelling is offered, not required.
    assert summary["today"] == {
        "new_words": 5,
        "target": 5,
        "plan_done": True,
        "extra_new": 0,
        "spelling": {
            "ready": 5,
            "due": 0,
            "today": 5,
            "today_left": 5,
            "hard": 0,
            "known": 0,
            "met": 5,
            "paused": None,
        },
    }
    assert summary["ratings"]["easy"] == 1
    by_word = {row["word"]["headword"]: row for row in summary["words"]}
    # «Легко» graduates at once; the others needed a second showing, «Снова» a third.
    assert (by_word["water"]["showings"], by_word["house"]["showings"]) == (1, 2)
    assert (by_word["friend"]["showings"], by_word["friend"]["lowest_rating"]) == (3, 1)
    # Due from the start of a later study day: 4 AM (UTC here), as in Anki (ADR 0025).
    tomorrow = datetime(2026, 11, 3, 4, 0, tzinfo=UTC)
    for row in summary["words"]:
        assert datetime.fromisoformat(row["next_review_at"]) >= tomorrow

    deck = client.get("/api/decks", headers=at(DAY0)).json()[0]
    assert (deck["introduced_count"], deck["due_count"]) == (5, 0)


def test_due_cards_come_back_first_and_score_as_reviews(client: TestClient, play: Play) -> None:
    play(STUDY, DAY0)
    later = DAY0 + timedelta(days=10)
    shown = cards(start(client, later).json())
    assert [card["new"] for card in shown] == [False] * 5 + [True] * 5
    summary = play(STUDY, later, ratings={"house": 1})
    assert summary["reviewed_words"] == 5
    assert summary["today"]["new_words"] == 5  # the reviews came first, then today's new words


def test_a_repeated_rating_counts_once_and_the_first_one_stands(client: TestClient) -> None:
    session = start(client).json()
    first = rate_card(client, session["id"], "c1", 4).json()
    again = rate_card(client, session["id"], "c1", 1).json()
    assert again == first | {"inserted": []}  # the stored answer, without re-inserting
    after = client.get(f"/api/sessions/{session['id']}").json()
    assert [r["exercise_id"] for r in after["results"]] == ["c1"]


def test_an_unfinished_session_resumes(client: TestClient) -> None:
    session = start(client).json()
    rate_card(client, session["id"], "c1", 4)
    active = client.get("/api/sessions/active").json()["session"]
    assert active["id"] == session["id"]
    assert [r["exercise_id"] for r in active["results"]] == ["c1"]
    assert start(client).json()["id"] == session["id"]


def test_hard_word_practice_does_not_move_the_schedule(
    client: TestClient, db: Session, play: Play
) -> None:
    play(STUDY, DAY0, ratings={"friend": 1, "buy": 2})
    before = {p.word_id: p.due_at for p in db.scalars(select(UserWordProgress))}
    practice = start(client, DAY0 + timedelta(hours=1), HARD).json()
    assert practice["kind"] == "hard"
    # The learner's hardest words first: the forgotten one, then the hard one.
    assert [card["word"]["headword"] for card in practice["exercises"]][:2] == ["friend", "buy"]
    summary = play(HARD, DAY0 + timedelta(hours=1), ratings={"friend": 1})
    assert summary["today"]["new_words"] == 5  # practice adds nothing to the plan
    db.expire_all()
    assert {p.word_id: p.due_at for p in db.scalars(select(UserWordProgress))} == before


def test_another_learner_cannot_read_or_change_a_session(client: TestClient) -> None:
    session = start(client).json()
    assert client.get(f"/api/sessions/{session['id']}", headers=OTHER_USER).status_code == 404
    response = client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": "c1", "response": rate(3)},
        headers=OTHER_USER,
    )
    assert response.status_code == 404
    assert client.get("/api/sessions/active", headers=OTHER_USER).json() == {"session": None}


def test_invalid_ratings_are_rejected(client: TestClient) -> None:
    session = start(client).json()
    path = f"/api/sessions/{session['id']}/attempts"
    for body in (
        {"exercise_id": "c1", "response": rate(5)},
        {"exercise_id": "c1", "response": {"kind": "seen"}},
        {"exercise_id": "c1", "response": rate(3), "extra": 1},
    ):
        assert client.post(path, json=body).status_code == 422
    assert client.post(path, json={"exercise_id": "c99", "response": rate(3)}).status_code == 404
    out_of_order = client.post(path, json={"exercise_id": "c2", "response": rate(3)})
    assert (out_of_order.status_code, out_of_order.json()["error"]["code"]) == (409, "out_of_order")


def test_completion_rules(client: TestClient, play: Play) -> None:
    session = start(client).json()
    early = client.post(f"/api/sessions/{session['id']}/complete")
    assert (early.status_code, early.json()["error"]["code"]) == (409, "session_incomplete")
    summary = play(STUDY, DAY0, spell=False)  # resumes and finishes the open session
    again = client.post(f"/api/sessions/{summary['session_id']}/complete", headers=at(DAY0))
    assert again.json()["today"] == summary["today"]


def test_nothing_to_study_when_the_deck_is_done_and_nothing_is_due(
    client: TestClient, db: Session
) -> None:
    client.get("/api/decks")  # creates the dev user
    user = db.scalars(select(User)).one()
    for word_id in db.scalars(select(DeckWord.word_id).where(DeckWord.deck_id == "a1-a2")):
        db.add(
            UserWordProgress(
                user_id=user.id,
                word_id=word_id,
                introduced_at=DAY0,
                last_seen_at=DAY0,
                fsrs_state=2,
                stability=30.0,
                difficulty=5.0,
                due_at=DAY0 + timedelta(days=30),
            )
        )
    db.commit()
    response = start(client)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "nothing_to_study")


def test_unknown_deck_and_bad_dev_user(client: TestClient) -> None:
    unknown = client.post("/api/sessions", json={"kind": "study", "deck_id": "nope"})
    assert unknown.status_code == 404
    assert client.get("/api/decks", headers={"X-Dev-User": "Bad Name!"}).status_code == 400


def test_a_review_answered_just_before_four_in_the_morning_waits_for_its_day(
    client: TestClient, db: Session, play: Play
) -> None:
    """At 3:55 it is still yesterday's study day (ADR 0025): a one-day review is due at 4:00,
    five minutes later — it is a review for the new day, not a learning step to repeat now."""
    play(STUDY, DAY0, spell=False)
    for progress in db.scalars(select(UserWordProgress)):
        progress.stability, progress.due_at = 0.3, datetime(2026, 11, 3, 3, 0, tzinfo=UTC)
    db.commit()
    late = datetime(2026, 11, 3, 3, 55, tzinfo=UTC)
    session = start(client, late).json()
    first = cards(session)[0]
    result = rate_card(client, session["id"], first["id"], 2, late).json()
    assert datetime.fromisoformat(result["next_due_at"]) == datetime(2026, 11, 3, 4, 0, tzinfo=UTC)
    assert result["inserted"] == []
