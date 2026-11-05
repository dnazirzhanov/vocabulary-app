"""Spelling through the API (ADR 0016): cards built from a word's Russian meaning with letter
tiles; which words, and how well each is spelled, by a short ladder (ADR 0026)."""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ReviewAttempt
from tests.support import Play, at, cards, finish, headword_of, spell, spell_today

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
    # The word comes only to be heard (ADR 0047); everything else is the meaning, no word.
    assert first.pop("pronunciation") == {"key": "house", "text": "house"}
    assert set(first) == {"id", "type", "prompt", "slots", "separators", "tiles", "hint"}
    assert first["hint"] is None
    assert (first["prompt"]["translation"], first["slots"]) == ("дом", 5)
    assert "house" not in str(first)
    assert all(letter in first["tiles"] for letter in "house")


def test_nothing_to_spell_before_any_word_is_met(client: TestClient) -> None:
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


def spelling_state(client: TestClient, moment: datetime = DAY0) -> dict[str, Any]:
    state: dict[str, Any] = client.get("/api/progress", headers=at(moment)).json()["spelling_today"]
    return state


def spelled_words(client: TestClient, body: Mapping[str, object], moment: datetime) -> list[str]:
    """Starts a spelling session and names its words (read from the stored plan)."""
    session = client.post("/api/sessions", json=body, headers=at(moment)).json()
    return [headword_of(session["id"], exercise["id"]) for exercise in session["exercises"]]


def test_spelling_is_tracked_and_offered_after_a_lesson(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0, spell=False)
    report = progress(client)
    # The finished lesson keeps the day (ADR 0027); spelling waits for the learner.
    assert report["today"]["studied"] is True
    assert report["spelling_today"] | {"met": 5} == {
        "ready": 5,
        "due": 0,
        "today": 5,
        "today_left": 5,
        "hard": 0,
        "known": 0,
        "met": 5,
        "paused": None,
    }
    spell_today(client, at(DAY0), {"water": "wtaer"})
    # Spelled: nothing more for the main button today; the miss is a hard word.
    assert spelling_state(client) | {"met": 5} == {
        "ready": 0,
        "due": 0,
        "today": 5,
        "today_left": 0,
        "hard": 1,
        "known": 0,
        "met": 5,
        "paused": None,
    }
    nothing = client.post("/api/sessions", json=SPELLING, headers=at(DAY0))
    assert (nothing.status_code, nothing.json()["error"]["code"]) == (409, "nothing_to_spell")


def test_todays_words_can_be_spelled_again_and_extra_practice_changes_nothing(
    client: TestClient, play: Play
) -> None:
    play(STUDY, DAY0)  # the lesson and its spelling
    before = progress(client)
    today = {"kind": "spelling", "mode": "today"}
    again = spell_today(client, at(DAY0 + timedelta(minutes=5)), start=today)
    assert again is not None and again["spelling"]["words"] == 5
    after = progress(client)
    # The heatmap counts the extra cards as the day's work.
    assert after["today"]["cards"] == before["today"]["cards"] + 5
    # Right again the same day, before it is due: no word climbs twice in a day.
    assert (after["spelling_today"]["known"], after["spelling_today"]["hard"]) == (0, 0)


def test_a_big_day_is_spelled_ten_words_at_a_time(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    for hour in range(3):  # fifteen new words: five planned, ten as bonus
        play(STUDY, DAY0 + timedelta(hours=hour), spell=False)
    later = DAY0 + timedelta(hours=4)
    assert spelling_state(client, later)["ready"] == 10
    first = spelled_words(client, SPELLING, later)
    assert len(first) == 10  # in the order learned
    finish_active(client, later)
    assert spelling_state(client, later)["ready"] == 5
    # The size can be chosen: 5, 10, 20 or 30.
    rest = spell_today(client, at(later), start={"kind": "spelling", "size": 20})
    assert rest is not None and rest["spelling"]["words"] == 5
    refused = client.post("/api/sessions", json={"kind": "spelling", "size": 7}, headers=at(later))
    assert refused.status_code == 422


def finish_active(client: TestClient, moment: datetime) -> None:
    """Spells the open session's words right and completes it."""
    active = client.post("/api/sessions", json=SPELLING, headers=at(moment)).json()  # resumes
    finish(client, active, at(moment))
    client.post(f"/api/sessions/{active['id']}/complete", headers=at(moment))


def test_a_misspelled_word_comes_back_until_it_is_spelled_on_three_days(
    client: TestClient, play: Play
) -> None:
    """ADR 0026: a miss is due the next day; right when due, it climbs and waits 3, then 7
    days; right on the third rung it is «умеет писать» and leaves the rotation."""
    play(STUDY, DAY0, spellings={"water": "wtaer"})
    assert spelling_state(client)["hard"] == 1
    # «Трудные» holds it at once; right again the same day, it is still hard (not due yet).
    assert spelled_words(client, {"kind": "spelling", "mode": "hard"}, DAY0) == ["water"]
    finish_active(client, DAY0)
    assert spelling_state(client)["hard"] == 1
    # The next morning it is due: the main set is water alone (the rest wait, none is new).
    day1 = DAY0 + timedelta(days=1)
    assert spelling_state(client, day1)["due"] == 1
    assert spelled_words(client, SPELLING, day1) == ["water"]
    finish_active(client, day1)  # right: rung 1
    hard = client.post("/api/sessions", json={"kind": "spelling", "mode": "hard"}, headers=at(day1))
    assert hard.status_code == 409  # no hard words left
    # The other four (spelled right on day 0, rung 1) are due on day 3; water on day 4.
    day3, day4 = DAY0 + timedelta(days=3), DAY0 + timedelta(days=4)
    assert spelling_state(client, day3)["due"] == 4
    spell_today(client, at(day3))
    assert spelling_state(client, day3)["due"] == 0
    assert spelling_state(client, day4)["due"] == 1
    spell_today(client, at(day4))  # water: rung 2, due a week later
    day10 = DAY0 + timedelta(days=10)
    spell_today(client, at(day10))  # the four: rung 3
    assert spelling_state(client, day10)["known"] == 4
    day11 = DAY0 + timedelta(days=11)
    spell_today(client, at(day11))  # water too
    state = spelling_state(client, day11)
    assert (state["known"], state["hard"], state["ready"]) == (5, 0, 0)


def test_a_hinted_word_counts_as_hard(client: TestClient, play: Play) -> None:
    play(STUDY, DAY0, spell=False)
    session = start_spelling(client).json()
    house = session["exercises"][0]["id"]
    hint(client, session, house, 0)
    answer(client, session, house, "house")
    assert spelling_state(client)["hard"] == 1


def test_random_draws_from_every_word_met(client: TestClient, play: Play) -> None:
    play(STUDY, DAY0)
    play(STUDY, DAY0 + timedelta(days=1), spell=False)
    later = DAY0 + timedelta(days=1, hours=1)
    words = spelled_words(client, {"kind": "spelling", "mode": "random", "size": 5}, later)
    assert len(words) == len(set(words)) == 5
    finish_active(client, later)
    everything = spelled_words(client, {"kind": "spelling", "mode": "random", "size": 30}, later)
    assert sorted(everything) == sorted(set(everything)) and len(everything) == 10  # each once


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
    resumed = start_spelling(client).json()  # resumes the open one
    card = resumed["exercises"][0]
    assert card["hint"] == {"position": 2, "letter": "u"}
    card.pop("pronunciation")
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


def test_a_paused_spelling_keeps_its_place_and_never_blocks_a_lesson(
    client: TestClient, play: Play
) -> None:
    """ADR 0026: left unfinished, spelling says how far it got and resumes there; a lesson can
    be taken meanwhile."""
    play(STUDY, DAY0, spell=False)
    session = start_spelling(client).json()
    first, second = session["exercises"][0]["id"], session["exercises"][1]["id"]
    answer(client, session, first, "house")
    answer(client, session, second, "wtaer")
    assert spelling_state(client)["paused"] == {"spelled": 2, "right": 1, "total": 5}

    # A lesson starts as usual, beside the paused spelling.
    later = DAY0 + timedelta(days=1)
    lesson = client.post("/api/sessions", json=STUDY, headers=at(later)).json()
    assert lesson["kind"] == "study" and lesson["id"] != session["id"]
    assert (
        client.get("/api/sessions/active", headers=at(later)).json()["session"]["id"]
        == (lesson["id"])
    )
    # Spelling again resumes the paused one, with its two answers, whatever set is asked for.
    resumed = client.post(
        "/api/sessions", json={"kind": "spelling", "mode": "random"}, headers=at(later)
    ).json()
    assert resumed["id"] == session["id"] and len(resumed["results"]) == 2
    finish(client, resumed, at(later))
    client.post(f"/api/sessions/{session['id']}/complete", headers=at(later))
    assert spelling_state(client, later)["paused"] is None
