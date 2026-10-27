"""Spelling in the daily lesson through the API (ADR 0016)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ReviewAttempt, UserWordSpelling
from tests.support import Play, at, cards, finish, headword_of, rate, spell

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
STUDY = {"kind": "study", "deck_id": "a1-a2"}
WORDS = ["house", "water", "friend", "buy", "cheap"]


def start(client: TestClient, moment: datetime = DAY0) -> dict[str, Any]:
    session: dict[str, Any] = client.post("/api/sessions", json=STUDY, headers=at(moment)).json()
    return session


def answer(
    client: TestClient, session: dict[str, Any], exercise_id: str, response: dict[str, object]
) -> Any:
    return client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": exercise_id, "response": response},
        headers=at(DAY0),
    )


def exercises(client: TestClient, session: dict[str, Any]) -> list[dict[str, Any]]:
    current: list[dict[str, Any]] = client.get(
        f"/api/sessions/{session['id']}", headers=at(DAY0)
    ).json()["exercises"]
    return current


def answer_right_until(client: TestClient, session: dict[str, Any], stop_id: str) -> None:
    """Builds every word right, in order, up to the exercise `stop_id`."""
    for exercise in exercises(client, session):
        if exercise["id"] == stop_id:
            return
        if exercise["type"] != "card" and exercise["id"] not in answered(client, session):
            answer(
                client, session, exercise["id"], spell(headword_of(session["id"], exercise["id"]))
            )


def answered(client: TestClient, session: dict[str, Any]) -> set[str]:
    results = client.get(f"/api/sessions/{session['id']}", headers=at(DAY0)).json()["results"]
    return {result["exercise_id"] for result in results}


def rate_cards(client: TestClient, session: dict[str, Any]) -> list[dict[str, Any]]:
    """Rates the flashcards «Легко» (no repeats); returns the spelling exercises that follow."""
    for card in cards(session):
        answer(client, session, card["id"], rate(4))
    return [e for e in session["exercises"] if e["type"] != "card"]


def test_spelling_follows_the_cards_guided_first_then_recall_without_the_word(
    client: TestClient,
) -> None:
    session = start(client)
    spelling = [e for e in session["exercises"] if e["type"] != "card"]
    assert [e["type"] for e in spelling] == ["spell_guided"] * 5 + ["spell_recall"] * 5
    guided, recall = spelling[0], spelling[5]
    assert guided["word"]["headword"] == "house"
    assert sorted(set(guided["tiles"]) & set("house")) == sorted(set("house"))
    # Recall gives nothing away: no headword, no word id, no example, no audio.
    assert set(recall) == {"id", "type", "prompt", "slots", "tiles", "retry"}
    assert set(recall["prompt"]) == {"translation", "pos", "example_ru"}
    assert (recall["prompt"]["translation"], recall["slots"]) == ("дом", 5)
    assert "house" not in str(recall)


def test_a_wrong_recall_brings_guided_practice_and_one_retry(client: TestClient) -> None:
    session = start(client)
    spelling = rate_cards(client, session)
    for guided in spelling[:5]:
        answer(client, session, guided["id"], spell(guided["word"]["headword"]))
    first_recall = spelling[5]
    missed = answer(client, session, first_recall["id"], spell("huose")).json()
    assert (missed["correct"], missed["answer"]) == (False, "house")  # the word, once answered
    kinds = [(e["index"], e["exercise"]["type"]) for e in missed["inserted"]]
    assert kinds[0][1] == "spell_guided" and kinds[1][1] == "spell_recall"
    retry = missed["inserted"][1]["exercise"]
    assert retry["retry"] is True and kinds[1][0] > kinds[0][0] + 1

    # The retry missed too: guided once more, and no third recall.
    answer_right_until(client, session, retry["id"])
    again = answer(client, session, retry["id"], spell("hose")).json()
    assert [e["exercise"]["type"] for e in again["inserted"]] == ["spell_guided"]


def test_showing_the_word_never_counts_as_recalled(
    client: TestClient, db: Session, play: Play
) -> None:
    session = start(client)
    spelling = rate_cards(client, session)
    for guided in spelling[:5]:
        answer(client, session, guided["id"], spell(guided["word"]["headword"]))
    shown = answer(client, session, spelling[5]["id"], spell("house", hint_used=True)).json()
    assert (shown["correct"], shown["hint_used"]) == (True, True)
    assert shown["inserted"]  # practised like a miss
    answer_right_until(client, session, "end")
    summary = client.post(f"/api/sessions/{session['id']}/complete", headers=at(DAY0)).json()
    assert summary["spelling"] == {"words": 5, "first_try": 4, "needs_practice": 1}
    house = db.scalars(select(UserWordSpelling).where(UserWordSpelling.word_id == "house")).one()
    assert house.stage == 0


def test_an_answer_counts_once(client: TestClient, db: Session) -> None:
    session = start(client)
    spelling = rate_cards(client, session)
    first = answer(client, session, spelling[0]["id"], spell("house")).json()
    again = answer(client, session, spelling[0]["id"], spell("wrong")).json()
    assert again == first | {"inserted": []}
    count = db.scalar(
        select(func.count())
        .select_from(ReviewAttempt)
        .where(ReviewAttempt.exercise_type == "spell_guided")
    )
    assert count == 1


def test_a_card_takes_a_rating_and_spelling_takes_letters(client: TestClient) -> None:
    session = start(client)
    wrong = answer(client, session, cards(session)[0]["id"], spell("house"))
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (422, "wrong_response")


def test_words_come_back_for_recall_on_their_own_schedule(
    client: TestClient, db: Session, play: Play
) -> None:
    summary = play(STUDY, DAY0, spellings={"house": "huose"})
    assert summary["spelling"] == {"words": 5, "first_try": 4, "needs_practice": 1}
    rows = {row.word_id: row for row in db.scalars(select(UserWordSpelling))}
    assert (rows["water"].stage, rows["house"].stage) == (1, 0)
    assert all(row.due_at == datetime(2026, 11, 3, tzinfo=UTC) for row in rows.values())

    tomorrow = start(client, DAY0 + timedelta(days=1))
    spelling = [e for e in tomorrow["exercises"] if e["type"] != "card"]
    reviews = [e["prompt"]["translation"] for e in spelling if e["type"] == "spell_recall"]
    # Yesterday's five words come back as recall only, before today's new words' recall.
    assert {"дом", "вода"} <= set(reviews[:5])
    guided = {e["word"]["headword"] for e in spelling if e["type"] == "spell_guided"}
    assert guided.isdisjoint(WORDS)


def test_the_day_counts_once_the_spelling_is_finished(client: TestClient) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    session = start(client)
    spelling = rate_cards(client, session)

    def today() -> dict[str, Any]:
        report: dict[str, Any] = client.get("/api/progress", headers=at(DAY0)).json()
        return report

    report = today()
    assert (report["today"]["new_words"], report["today"]["plan_done"]) == (5, False)
    assert report["spelling_today"] == {"words": 5, "done": 0}
    finish(client, session | {"exercises": spelling}, at(DAY0))
    client.post(f"/api/sessions/{session['id']}/complete", headers=at(DAY0))
    report = today()
    assert report["today"]["plan_done"] is True
    assert report["spelling_today"] == {"words": 5, "done": 5}


def test_spelling_earns_no_points(client: TestClient, db: Session, play: Play) -> None:
    play(STUDY, DAY0, spellings={"water": "wtaer"})
    spelling_points = db.scalar(
        select(func.coalesce(func.sum(ReviewAttempt.points), 0)).where(
            ReviewAttempt.exercise_type != "card"
        )
    )
    assert spelling_points == 0
