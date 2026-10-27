"""The course as levels (ADR 0014): decks in level order, later levels locked, today's counts per
deck, and study sessions for one deck or for everything due («Продолжить»)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DeckWord, User, UserWordProgress
from tests.support import Play, at

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


def decks(client: TestClient, moment: datetime = DAY0) -> dict[str, Any]:
    return {d["id"]: d for d in client.get("/api/decks", headers=at(moment)).json()}


def meet_whole_deck(
    db: Session, deck_id: str, moment: datetime, due_at: datetime | None = None
) -> None:
    """Every word of the deck met at `moment`, next due in 30 days unless `due_at` is given."""
    user = db.scalars(select(User)).one()
    for word_id in db.scalars(select(DeckWord.word_id).where(DeckWord.deck_id == deck_id)):
        db.add(
            UserWordProgress(
                user_id=user.id,
                word_id=word_id,
                introduced_at=moment,
                last_seen_at=moment,
                fsrs_state=2,
                stability=30.0,
                difficulty=5.0,
                due_at=due_at or moment + timedelta(days=30),
            )
        )
    db.commit()


def test_new_cards_today_follow_the_pace_and_count_down(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 10}, headers=at(DAY0 - timedelta(days=30)))
    before = decks(client)
    assert (before["a1-a2"]["new_today"], before["b1-b2"]["new_today"]) == (10, 0)
    play({"kind": "study", "deck_id": "a1-a2"}, DAY0)
    after = decks(client)
    assert (after["a1-a2"]["new_today"], after["a1-a2"]["introduced_count"]) == (0, 10)


def test_the_next_level_opens_when_the_current_one_is_met(client: TestClient, db: Session) -> None:
    client.get("/api/decks")  # creates the dev user
    meet_whole_deck(db, "a1-a2", DAY0)
    opened = decks(client)
    assert [opened[d]["locked"] for d in ("a1-a2", "b1-b2", "c1")] == [False, False, True]
    assert opened["b1-b2"]["new_today"] == 5


def test_a_locked_level_cannot_be_studied(client: TestClient) -> None:
    refused = client.post("/api/sessions", json={"kind": "study", "deck_id": "c1"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "deck_locked")


def test_a_deck_session_reviews_only_that_deck(client: TestClient, db: Session) -> None:
    client.get("/api/decks")
    meet_whole_deck(db, "a1-a2", DAY0 - timedelta(days=40), due_at=DAY0 + timedelta(days=30))
    # Three A1–A2 words are due now; the rest later.
    due_now = list(db.scalars(select(UserWordProgress).limit(3)))
    for progress in due_now:
        progress.due_at = DAY0 - timedelta(hours=1)
    db.commit()

    deck_only = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "b1-b2"}, headers=at(DAY0)
    ).json()
    assert all(card["new"] for card in deck_only["exercises"])  # no A1–A2 reviews here
    assert deck_only["deck_id"] == "b1-b2"


def test_continue_starts_with_every_level_s_due_cards(client: TestClient, db: Session) -> None:
    client.get("/api/decks")
    meet_whole_deck(db, "a1-a2", DAY0 - timedelta(days=40), due_at=DAY0 + timedelta(days=30))
    due_now = list(db.scalars(select(UserWordProgress).limit(3)))
    for progress in due_now:
        progress.due_at = DAY0 - timedelta(hours=1)
    db.commit()

    session = client.post("/api/sessions", json={"kind": "study"}, headers=at(DAY0)).json()
    cards = session["exercises"]
    assert {card["word"]["id"] for card in cards if not card["new"]} == {
        progress.word_id for progress in due_now
    }
    assert [card["new"] for card in cards] == [False] * 3 + [True] * 5
    assert session["deck_id"] == "b1-b2"  # the current level supplies the new words


def test_due_cards_are_split_into_learning_and_reviews(client: TestClient, db: Session) -> None:
    client.get("/api/decks")
    meet_whole_deck(db, "a1-a2", DAY0 - timedelta(days=40), due_at=DAY0 + timedelta(days=30))
    cards = list(db.scalars(select(UserWordProgress).order_by(UserWordProgress.word_id).limit(5)))
    for progress, state in zip(cards, (1, 3, 2, 2, 2), strict=True):  # learning, relearning, review
        progress.fsrs_state, progress.due_at = state, DAY0 - timedelta(minutes=5)
    db.commit()
    a1 = decks(client)["a1-a2"]
    assert (a1["due_count"], a1["learning_count"], a1["review_count"]) == (5, 2, 3)
