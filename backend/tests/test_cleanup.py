"""Removing old answers (ADR 0044) must change nothing a learner can see."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import LearningSession, ReviewAttempt, StudyDayTotal
from app.services.cleanup import KEEP_ANSWERS, clean_up
from app.services.study_days import HISTORY_DAYS
from tests.support import Play, at, finish, named

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)  # a Wednesday
STUDY = {"kind": "study", "deck_id": "a1-a2"}
BISHKEK = "Asia/Bishkek"
OWN_WORDS = [
    {"headword": "setback", "pos": "noun", "translation": "неудача", "example": "A setback."},
    {"headword": "carry out", "pos": "phrase", "translation": "выполнять", "example": "Carry out."},
]


def days_ago(days: int) -> datetime:
    return NOW - timedelta(days=days)


def answers(db: Session) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(ReviewAttempt)) or 0


def clean(db: Session, moment: datetime = NOW) -> Any:
    result = clean_up(db, moment)
    db.expire_all()
    return result


def everything_a_learner_sees(client: TestClient, group_id: str) -> dict[str, Any]:
    headers = at(NOW, BISHKEK)
    paths = [
        "/api/progress",
        "/api/progress/decks",
        "/api/decks",
        "/api/decks/library",
        "/api/decks/a1-a2/stats",
        "/api/decks/a1-a2/words",
        "/api/me/pace?deck_id=a1-a2",
        "/api/groups",
        f"/api/groups/{group_id}/board?period=week",
        f"/api/groups/{group_id}/board?period=month",
        f"/api/groups/{group_id}/board?period=all",
    ]
    seen = {}
    for path in paths:
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)
        seen[path] = response.json()
    return seen


def test_every_screen_reads_the_same_after_old_answers_are_removed(
    client: TestClient, db: Session, play: Play
) -> None:
    group = client.post(
        "/api/groups",
        json={"name": "7Б"},
        headers=named(client, at(days_ago(70), BISHKEK), "Ольга"),
    ).json()
    # Lessons long ago, whose words come back as reviews, one forgotten; and lately, in the window.
    forgot_once: dict[str, int] = {}
    for ago in (60, 50, 45, 40, 38, 20, 10, 2):
        play(STUDY, days_ago(ago), time_zone=BISHKEK, ratings=forgot_once)
    # An evening lesson that is already tomorrow by the clock of the learner: days are local.
    play(STUDY, days_ago(39) + timedelta(hours=8), time_zone=BISHKEK)
    # A deck of my own, studied only long ago: nothing recent says it was started.
    old_headers = at(days_ago(55), BISHKEK)
    mine = client.post("/api/decks", json={"title": "Старая"}, headers=old_headers).json()
    for word in OWN_WORDS:
        client.post(f"/api/decks/{mine['id']}/words", json=word, headers=old_headers)
    play({"kind": "study", "deck_id": mine["id"]}, days_ago(55), time_zone=BISHKEK, spell=False)

    before = everything_a_learner_sees(client, group["id"])
    total = answers(db)
    assert total > 0
    # The comparison means something only if these are there to lose.
    assert before["/api/progress/decks"]["learned"] > 0
    assert mine["id"] in [deck["id"] for deck in before["/api/progress/decks"]["decks"]]
    assert any(day["studied"] for day in before["/api/progress"]["activity"])

    cleaned = clean(db)

    assert cleaned.lessons > 0 and cleaned.finished
    assert 0 < answers(db) < total
    assert db.scalar(select(func.count()).select_from(StudyDayTotal))
    assert everything_a_learner_sees(client, group["id"]) == before


def test_recent_answers_and_unfinished_lessons_are_left_alone(
    client: TestClient, db: Session, play: Play
) -> None:
    play(STUDY, days_ago(3))
    recent = answers(db)
    # A lesson started long ago, answered once, never finished: it can still be resumed.
    open_session = client.post("/api/sessions", json=STUDY, headers=at(days_ago(100))).json()
    exercise = next(item for item in open_session["exercises"] if item["type"] == "card")
    client.post(
        f"/api/sessions/{open_session['id']}/attempts",
        json={"exercise_id": exercise["id"], "response": {"kind": "rating", "rating": 3}},
        headers=at(days_ago(100)),
    )
    assert answers(db) == recent + 1

    assert clean(db).lessons == 0
    assert answers(db) == recent + 1
    resumed = client.get("/api/sessions/active", headers=at(NOW)).json()["session"]
    assert resumed["id"] == open_session["id"]
    finish(client, resumed, at(NOW))  # the card already answered returns its stored result
    done = client.post(f"/api/sessions/{resumed['id']}/complete", headers=at(NOW))
    assert done.status_code == 200, done.text


def test_a_lesson_is_cleaned_only_once_past_the_window(db: Session, play: Play) -> None:
    moment = NOW - KEEP_ANSWERS
    play(STUDY, moment + timedelta(hours=1), spell=False)
    assert clean(db).lessons == 0
    assert clean(db, NOW + timedelta(hours=2)).lessons == 1


def test_running_it_twice_counts_nothing_twice(client: TestClient, db: Session, play: Play) -> None:
    play(STUDY, days_ago(60))
    clean(db)
    first = db.scalars(select(StudyDayTotal.answers)).all()
    assert first
    assert clean(db).lessons == 0
    db.expire_all()
    assert db.scalars(select(StudyDayTotal.answers)).all() == first


def test_a_day_cleaned_in_two_parts_adds_up(db: Session, play: Play) -> None:
    moment = days_ago(60)
    play(STUDY, moment, spell=False)
    user_id = db.scalars(select(LearningSession.user_id)).one()
    lesson_answers = answers(db)
    # What an earlier run left for the same day, of a lesson that ended up unfinished until then.
    db.add(StudyDayTotal(user_id=user_id, day=moment.date(), answers=7, finished=False))
    db.commit()
    clean(db)
    total = db.scalars(select(StudyDayTotal)).one()
    assert (total.answers, total.finished) == (7 + lesson_answers, True)


def test_a_finished_lessons_page_still_opens_after_it_is_cleaned(
    client: TestClient, db: Session, play: Play
) -> None:
    play(STUDY, days_ago(60), spell=False)
    session_id = db.scalars(select(LearningSession.id)).first()
    clean(db)
    assert db.get_one(LearningSession, session_id).plan == []
    shown = client.get(f"/api/sessions/{session_id}", headers=at(NOW))
    assert shown.status_code == 200 and shown.json()["completed"] is True


def test_totals_older_than_the_calendar_shows_are_removed(db: Session, play: Play) -> None:
    play(STUDY, days_ago(60), spell=False)
    clean(db)
    assert db.scalars(select(StudyDayTotal.day)).all()
    clean(db, NOW + timedelta(days=HISTORY_DAYS + 40))
    assert db.scalars(select(StudyDayTotal.day)).all() == []


def test_the_cleanup_endpoint_answers_only_the_scheduler(db: Session, play: Play) -> None:
    settings = Settings(
        environment="test",
        database_url=get_settings().database_url,
        reminders_token="the-secret",  # noqa: S106
        _env_file=None,
    )
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    play(STUDY, days_ago(60), spell=False)
    with TestClient(app) as client:
        assert client.post("/api/internal/cleanup").status_code == 404
        guess = {"X-Reminders-Token": "a-guess"}
        assert client.post("/api/internal/cleanup", headers=guess).status_code == 404
        headers = {"X-Reminders-Token": "the-secret"}
        done = client.post("/api/internal/cleanup", headers=headers)
    assert done.status_code == 200
    assert done.json()["lessons"] == 1 and done.json()["finished"] is True
