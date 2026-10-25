"""Spaced repetition through the API. X-Dev-Now moves the server clock, so "come back tomorrow"
is a header instead of a wait."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ReviewAttempt, UserWordProgress
from tests.support import Answers, Play, at, respond

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
START_NEW = {"kind": "new", "deck_id": "starter"}
START_REVIEW = {"kind": "review", "deck_id": "starter"}


def deck(client: TestClient, moment: datetime) -> dict[str, Any]:
    decks: list[dict[str, Any]] = client.get("/api/decks", headers=at(moment)).json()
    return decks[0]


def progress(db: Session, word_id: str) -> UserWordProgress:
    db.expire_all()
    return db.scalars(select(UserWordProgress).where(UserWordProgress.word_id == word_id)).one()


def test_new_words_come_back_the_next_day(play: Play, client: TestClient, answers: Answers) -> None:
    summary = play(START_NEW, DAY0)
    assert {w["next_review_at"] for w in summary["words"]} == {
        (DAY0 + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    }
    assert deck(client, DAY0)["due_count"] == 0
    assert deck(client, DAY0)["next_due_at"].startswith("2026-11-03T09:00")

    early = client.post("/api/sessions", json=START_REVIEW, headers=at(DAY0 + timedelta(hours=23)))
    assert (early.status_code, early.json()["error"]["code"]) == (409, "nothing_due")
    assert deck(client, DAY0 + timedelta(days=1))["due_count"] == 5


def test_a_review_asks_for_recall_then_production(
    play: Play, client: TestClient, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    session = client.post(
        "/api/sessions", json=START_REVIEW, headers=at(DAY0 + timedelta(days=1))
    ).json()
    assert session["kind"] == "review"
    assert [e["type"] for e in session["exercises"]] == ["recall_meaning"] * 5 + ["type_word"] * 5
    recall = session["exercises"][0]
    assert set(recall["word"]) == {"headword", "pos", "example"}  # meaning hidden until answered


def test_recalled_words_move_up_and_missed_words_return_tomorrow(
    play: Play, client: TestClient, db: Session, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    day1 = DAY0 + timedelta(days=1)
    # Exercise 1 is recall for "house"; 7 is typing "water". Both words count as not recalled.
    summary = play(START_REVIEW, day1, wrong=frozenset({"1", "7"}))

    next_review = {w["word"]["headword"]: w["next_review_at"] for w in summary["words"]}
    assert next_review["house"].startswith("2026-11-04T09:00")  # back to stage 1: +1 day
    assert next_review["water"].startswith("2026-11-04T09:00")
    assert next_review["friend"].startswith("2026-11-06T09:00")  # stage 2: +3 days

    house, friend = progress(db, "house"), progress(db, "friend")
    assert (house.stage, house.lapses, house.review_count) == (1, 1, 1)
    assert (friend.stage, friend.lapses, friend.review_count) == (2, 0, 1)
    assert friend.last_reviewed_at == day1

    # The attempt that rescheduled a word records the outcome (for later analysis).
    final = db.scalars(
        select(ReviewAttempt).where(
            ReviewAttempt.word_id == "friend",
            ReviewAttempt.exercise_type == "type_word",
            ReviewAttempt.stage_after.is_not(None),
        )
    ).one()
    assert (final.stage_after, final.due_after) == (2, day1 + timedelta(days=3))


def test_intervals_grow_across_repeated_reviews(
    play: Play, client: TestClient, db: Session, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    moment = DAY0
    for gap, expected_stage in ((1, 2), (3, 3), (7, 4), (16, 5)):
        moment += timedelta(days=gap)
        play(START_REVIEW, moment)
        assert progress(db, "house").stage == expected_stage
    assert progress(db, "house").due_at == moment + timedelta(days=35)


def test_most_overdue_words_are_reviewed_first_eight_at_a_time(
    play: Play, client: TestClient, answers: Answers
) -> None:
    play(START_NEW, DAY0)  # house … cheap, due day 1
    play(START_NEW, DAY0 + timedelta(hours=2))  # money … morning, due later
    day2 = DAY0 + timedelta(days=2)
    assert deck(client, day2)["due_count"] == 10

    session = client.post("/api/sessions", json=START_REVIEW, headers=at(day2)).json()
    reviewed = [
        e["word"]["headword"] for e in session["exercises"] if e["type"] == "recall_meaning"
    ]
    assert reviewed == ["house", "water", "friend", "buy", "cheap", "money", "city", "wait"]


def test_practice_and_new_sessions_never_change_the_schedule(
    play: Play, client: TestClient, db: Session, answers: Answers
) -> None:
    first = play(START_NEW, DAY0, wrong=frozenset({"2"}))
    due_before = progress(db, "house").due_at
    practice = {"kind": "practice", "source_session_id": first["session_id"]}
    play(practice, DAY0 + timedelta(hours=1))
    assert progress(db, "house").due_at == due_before
    assert progress(db, "house").stage == 1


def test_leaving_a_review_keeps_finished_words_scheduled(
    play: Play, client: TestClient, db: Session, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    day1 = DAY0 + timedelta(days=1)
    session = client.post("/api/sessions", json=START_REVIEW, headers=at(day1)).json()
    for exercise in session["exercises"][:6]:  # all recalls, then typing for "house" only
        client.post(
            f"/api/sessions/{session['id']}/attempts",
            json={"exercise_id": exercise["id"], "response": respond(exercise, answers, True)},
            headers=at(day1),
        )
    assert progress(db, "house").stage == 2
    assert progress(db, "water").stage == 1  # not finished in this session: still due
    assert deck(client, day1)["due_count"] == 4


def test_a_repeated_final_answer_advances_the_word_once(
    play: Play, client: TestClient, db: Session, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    day1 = DAY0 + timedelta(days=1)
    session = client.post("/api/sessions", json=START_REVIEW, headers=at(day1)).json()
    path = f"/api/sessions/{session['id']}/attempts"
    for exercise in session["exercises"][:6]:
        body = {"exercise_id": exercise["id"], "response": respond(exercise, answers, True)}
        client.post(path, json=body, headers=at(day1))
    client.post(path, json=body, headers=at(day1 + timedelta(minutes=1)))  # retry of "house"
    house = progress(db, "house")
    assert (house.stage, house.review_count) == (2, 1)


def test_new_words_can_still_be_started_while_reviews_are_due(
    play: Play, client: TestClient, answers: Answers
) -> None:
    play(START_NEW, DAY0)
    day1 = DAY0 + timedelta(days=1)
    session = client.post("/api/sessions", json=START_NEW, headers=at(day1)).json()
    assert session["kind"] == "new"
    assert session["exercises"][0]["word"]["headword"] == "money"


def test_dev_clock_must_be_a_full_timestamp(client: TestClient) -> None:
    for value in ("tomorrow", "2026-11-03T09:00:00"):
        response = client.get("/api/decks", headers={"X-Dev-Now": value})
        assert (response.status_code, response.json()["error"]["code"]) == (400, "invalid_dev_now")


def test_responses_carry_the_server_time(client: TestClient) -> None:
    moment = datetime(2026, 11, 3, 9, 0, tzinfo=UTC)
    assert (
        client.get("/api/decks", headers=at(moment)).headers["X-Server-Time"] == moment.isoformat()
    )
    assert "X-Server-Time" in client.get("/api/decks").headers
