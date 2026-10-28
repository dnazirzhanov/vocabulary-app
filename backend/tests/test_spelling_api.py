"""Spelling through the API (ADR 0016): a card per word learned today, built from its Russian
meaning with letter tiles; part of the day's plan, and free to repeat."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ReviewAttempt
from tests.support import Play, at, cards, headword_of, spell, spell_today

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
STUDY = {"kind": "study", "deck_id": "a1-a2"}
SPELLING = {"kind": "spelling"}


def start_spelling(client: TestClient, moment: datetime = DAY0) -> Any:
    return client.post("/api/sessions", json=SPELLING, headers=at(moment))


def answer(client: TestClient, session: dict[str, Any], exercise_id: str, built: str) -> Any:
    return client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": exercise_id, "response": spell(built)},
        headers=at(DAY0),
    )


def progress(client: TestClient) -> dict[str, Any]:
    report: dict[str, Any] = client.get("/api/progress", headers=at(DAY0)).json()
    return report


def test_the_lesson_is_cards_only_and_spelling_is_a_session_of_its_own(
    client: TestClient, play: Play
) -> None:
    lesson = client.post("/api/sessions", json=STUDY, headers=at(DAY0)).json()
    assert all(exercise["type"] == "card" for exercise in lesson["exercises"])
    play(STUDY, DAY0, spell=False)
    session = start_spelling(client).json()
    assert session["kind"] == "spelling"
    assert [e["type"] for e in session["exercises"]] == ["spelling"] * 5
    first = session["exercises"][0]
    # The meaning only: no headword, word id, example or audio.
    assert set(first) == {"id", "type", "prompt", "slots", "tiles", "hint"}
    assert first["hint"] is None
    assert (first["prompt"]["translation"], first["slots"]) == ("дом", 5)
    assert "house" not in str(first)
    assert all(letter in first["tiles"] for letter in "house")


def test_nothing_to_spell_before_any_word_is_learned_today(client: TestClient) -> None:
    refused = start_spelling(client)
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "nothing_to_spell")


def test_the_first_try_counts_and_the_word_is_shown_once_answered(
    client: TestClient, db: Session, play: Play
) -> None:
    play(STUDY, DAY0, spell=False)
    session = start_spelling(client).json()
    house = session["exercises"][0]["id"]
    missed = answer(client, session, house, "huose").json()
    assert (missed["correct"], missed["answer"], missed["inserted"]) == (False, "house", [])
    again = answer(client, session, house, "house").json()
    assert again == missed  # one stored answer per card: the first try
    for exercise in session["exercises"][1:]:
        answer(client, session, exercise["id"], headword_of(session["id"], exercise["id"]))
    summary = client.post(f"/api/sessions/{session['id']}/complete", headers=at(DAY0)).json()
    assert summary["spelling"] == {"words": 5, "first_try": 4, "needs_practice": 1}
    points = db.scalar(
        select(func.coalesce(func.sum(ReviewAttempt.points), 0)).where(
            ReviewAttempt.exercise_type == "spelling"
        )
    )
    assert points == 0  # spelling never earns points or a place on the board


def test_a_card_takes_a_rating_and_spelling_takes_letters(client: TestClient, play: Play) -> None:
    lesson = client.post("/api/sessions", json=STUDY, headers=at(DAY0)).json()
    wrong = client.post(
        f"/api/sessions/{lesson['id']}/attempts",
        json={"exercise_id": cards(lesson)[0]["id"], "response": spell("house")},
        headers=at(DAY0),
    )
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (422, "wrong_response")


def test_the_day_counts_once_the_new_words_are_spelled(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0, spell=False)
    report = progress(client)
    assert (report["today"]["plan_done"], report["spelling_today"]) == (
        False,
        {"words": 5, "done": 0},
    )
    spell_today(client, at(DAY0), {"water": "wtaer"})  # a mistake does not block the day
    report = progress(client)
    assert (report["today"]["plan_done"], report["spelling_today"]) == (
        True,
        {"words": 5, "done": 5},
    )


def test_spelling_can_be_repeated_and_extra_practice_changes_nothing(
    client: TestClient, play: Play
) -> None:
    play(STUDY, DAY0)  # the lesson and its spelling
    before = progress(client)
    again = spell_today(client, at(DAY0 + timedelta(minutes=5)))
    assert again is not None and again["spelling"]["words"] == 5
    after = progress(client)
    assert after["today"] == before["today"] and after["spelling_today"] == {"words": 5, "done": 5}


def test_a_bonus_lesson_adds_words_to_spell_but_not_to_the_plan(
    client: TestClient, play: Play
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0)
    play(STUDY, DAY0 + timedelta(hours=1), spell=False)  # five more: extra
    session = start_spelling(client, DAY0 + timedelta(hours=2)).json()
    assert len(session["exercises"]) == 10
    report = progress(client)
    assert report["today"]["plan_done"] is True  # the plan was five words, spelled already


def hint(client: TestClient, session: dict[str, Any], exercise_id: str, position: int) -> Any:
    return client.post(
        f"/api/sessions/{session['id']}/exercises/{exercise_id}/hint",
        json={"position": position},
        headers=at(DAY0),
    )


def test_one_hint_per_card_gives_one_letter_and_never_more(client: TestClient, play: Play) -> None:
    play(STUDY, DAY0, spell=False)
    session = start_spelling(client).json()
    house = session["exercises"][0]["id"]
    # Five letters, two built: the hint is the third letter of "house".
    assert hint(client, session, house, 2).json() == {"position": 2, "letter": "u"}
    assert hint(client, session, house, 2).json() == {"position": 2, "letter": "u"}  # same slot
    second = hint(client, session, house, 3)
    assert (second.status_code, second.json()["error"]["code"]) == (409, "hint_used")
    # The card remembers its hint after a reload, and still hides the rest of the word.
    resumed = client.get("/api/sessions/active", headers=at(DAY0)).json()["session"]
    card = resumed["exercises"][0]
    assert card["hint"] == {"position": 2, "letter": "u"}
    assert "house" not in str(card)
    # Another card has its own hint; past the end of a word there is no letter.
    water = session["exercises"][1]["id"]
    beyond = hint(client, session, water, 5)
    assert (beyond.status_code, beyond.json()["error"]["code"]) == (422, "no_such_letter")


def test_no_hint_once_a_card_is_answered_or_for_flashcards(client: TestClient, play: Play) -> None:
    lesson = client.post("/api/sessions", json=STUDY, headers=at(DAY0)).json()
    flashcard = hint(client, lesson, cards(lesson)[0]["id"], 0)
    assert (flashcard.status_code, flashcard.json()["error"]["code"]) == (404, "exercise_not_found")
    play(STUDY, DAY0, spell=False)  # finishes the open lesson
    session = start_spelling(client).json()
    house = session["exercises"][0]["id"]
    answer(client, session, house, "house")
    late = hint(client, session, house, 0)
    assert (late.status_code, late.json()["error"]["code"]) == (409, "already_answered")
