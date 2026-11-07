"""Study days (ADR 0027): a day counts when a session of any kind was finished. Which days were
promised is in test_promise.py."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.services.study_days import StudyDay, days_by_user
from tests.support import Play, at, rate

MONDAY = date(2026, 11, 2)
DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # Monday
STUDY = {"kind": "study", "deck_id": "a1-a2"}
SPELLING = {"kind": "spelling", "deck_id": "a1-a2"}
UTC_ZONE = ZoneInfo("UTC")


def day(on: date = MONDAY, answers: int = 5, finished: bool = True) -> StudyDay:
    return StudyDay(day=on, answers=answers, finished=finished)


# --- one day ---------------------------------------------------------------------------------


def test_a_day_counts_once_a_session_is_finished_however_short() -> None:
    assert day(answers=3).studied
    assert not day(answers=40, finished=False).studied  # many cards, nothing finished


# --- from the database -----------------------------------------------------------------------


def the_user(db: Session) -> User:
    return db.scalars(select(User)).one()


def test_a_finished_session_of_any_kind_counts_and_one_left_midway_does_not(
    client: TestClient, db: Session, play: Play
) -> None:
    play(STUDY, DAY0, spell=False)
    tuesday = DAY0 + timedelta(days=1)
    left = client.post("/api/sessions", json=STUDY, headers=at(tuesday)).json()
    client.post(
        f"/api/sessions/{left['id']}/attempts",
        json={"exercise_id": left["exercises"][0]["id"], "response": rate()},
        headers=at(tuesday),
    )  # one card, then left
    play(SPELLING, DAY0 + timedelta(days=2))  # spelling alone keeps a day
    user = the_user(db)
    days = days_by_user(db, [user], DAY0 - timedelta(days=1), UTC_ZONE)[user.id]
    assert [days[MONDAY + timedelta(days=n)].studied for n in range(3)] == [True, False, True]
    assert days[MONDAY + timedelta(days=1)].answers == 1


def test_days_are_local_to_the_learner(client: TestClient, db: Session, play: Play) -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)  # already Tuesday in Bishkek
    play(STUDY, late, time_zone="Asia/Bishkek")
    user = the_user(db)
    since = late - timedelta(days=2)
    assert set(days_by_user(db, [user], since, ZoneInfo("Asia/Bishkek"))[user.id]) == {
        date(2026, 11, 3)
    }
    db.refresh(user)  # starting the session stored the zone, as boards read it
    assert set(days_by_user(db, [user], since)[user.id]) == {date(2026, 11, 3)}
