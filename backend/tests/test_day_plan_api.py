"""The plan a study session records when it starts (ADR 0015): the day's new-word target, as the
app set it that day, and the days a week promised. Practice records none."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Deck, DeckWord, LearningSession, User, UserWordProgress
from tests.support import Play, at

DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
STUDY = {"kind": "study", "deck_id": "a1-a2"}
CONTINUE = {"kind": "study"}
HARD = {"kind": "hard", "deck_id": "a1-a2"}


def latest(db: Session) -> LearningSession:
    db.expire_all()
    session = db.scalars(
        select(LearningSession).order_by(LearningSession.started_at.desc())
    ).first()
    assert session is not None
    return session


def start(client: TestClient, body: dict[str, str], moment: datetime = DAY0) -> None:
    response = client.post("/api/sessions", json=body, headers=at(moment))
    assert response.status_code == 200, response.json()


def meet(db: Session, word_ids: list[str], due_at: datetime) -> None:
    """Words already met, in review and due at `due_at`."""
    user = db.scalars(select(User)).one()
    for word_id in word_ids:
        db.add(
            UserWordProgress(
                user_id=user.id,
                word_id=word_id,
                introduced_at=DAY0 - timedelta(days=60),
                last_seen_at=DAY0 - timedelta(days=60),
                fsrs_state=2,
                stability=30.0,
                difficulty=5.0,
                due_at=due_at,
            )
        )
    db.commit()


def words_of(db: Session, *deck_ids: str) -> list[str]:
    return list(
        db.scalars(
            select(DeckWord.word_id)
            .join(Deck, Deck.id == DeckWord.deck_id)
            .where(Deck.id.in_(deck_ids))
            .order_by(Deck.level_order, DeckWord.position)
        )
    )


def test_a_study_session_records_the_target_and_the_promise(
    client: TestClient, db: Session
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5, "study_days_per_week": 4})
    start(client, STUDY)
    session = latest(db)
    assert (session.day_target, session.promised_days) == (5, 4)


def test_a_bonus_lesson_still_records_the_day_s_target(
    client: TestClient, db: Session, play: Play
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0)  # today's five words
    start(client, STUDY, DAY0 + timedelta(hours=1))  # five more, a bonus
    assert latest(db).day_target == 5


def test_practice_records_no_plan(client: TestClient, db: Session, play: Play) -> None:
    play(STUDY, DAY0)
    start(client, HARD, DAY0 + timedelta(hours=1))
    session = latest(db)
    assert (session.kind, session.day_target, session.promised_days) == ("hard", None, None)


def test_too_many_reviews_due_records_a_plan_without_new_words(
    client: TestClient, db: Session
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})  # review brake from 50 cards due
    meet(db, words_of(db, "a1-a2")[:60], due_at=DAY0 - timedelta(hours=1))
    start(client, CONTINUE)
    assert latest(db).day_target == 0


def test_a_course_with_fewer_words_left_than_the_target_records_what_is_left(
    client: TestClient, db: Session
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    every = words_of(db, "a1-a2", "b1-b2", "c1")
    meet(db, every[:-3], due_at=DAY0 + timedelta(days=30))
    start(client, CONTINUE)
    assert latest(db).day_target == 3


def test_a_finished_earlier_level_still_records_the_course_target(
    client: TestClient, db: Session
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    a1 = words_of(db, "a1-a2")
    meet(db, a1[:3], due_at=DAY0 - timedelta(hours=1))  # a few reviews due on the finished level
    meet(db, a1[3:], due_at=DAY0 + timedelta(days=30))
    start(client, STUDY)  # this deck has no new words left, the course still has
    assert latest(db).day_target == 5


def test_a_warm_up_week_records_the_lower_target(client: TestClient, db: Session) -> None:
    client.patch("/api/me", json={"daily_target_words": 10, "ramp_enabled": True}, headers=at(DAY0))
    start(client, STUDY)
    assert latest(db).day_target == 5  # half of 10 in the first week
