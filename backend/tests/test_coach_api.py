"""The coach through its API (ADR 0071): a goal and its honest check, the week's targets counted
from what the learner really did, study times around their schedule, the commitment on their
promise, and the weekly adjustment from proposal to a changed plan."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import MentorGoal, SpeakingSession, User, WritingSubmission
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 15, 0, tzinfo=UTC)
NEXT_MONDAY = datetime(2026, 11, 23, 9, 0, tzinfo=UTC)
WEEKDAYS = [0, 1, 2, 3, 4]


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")


def as_(name: str = "ann", moment: datetime = THURSDAY, zone: str = "UTC") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, zone)


def coach(client: TestClient, **kwargs: Any) -> dict[str, Any]:
    response = client.get("/api/mentor/coach", headers=as_(**kwargs))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def set_goal(client: TestClient, who: str = "ann", **body: Any) -> dict[str, Any]:
    response = client.put("/api/mentor/coach/goal", json=body, headers=as_(who))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def commit(client: TestClient, start: int, minutes: int, days: list[int] = WEEKDAYS) -> Any:
    return client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": days, "start_minute": start, "minutes": minutes},
        headers=as_(),
    )


def user_of(db: Session, name: str = "ann") -> User:
    return db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()


def test_without_the_mentor_the_coach_is_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "e2e-mentor-*")
    assert client.get("/api/mentor/coach", headers=as_()).status_code == 403


def test_a_new_learner_has_no_goal_and_no_targets(client: TestClient) -> None:
    state = coach(client)
    assert state["goal"] is None and state["targets"] == [] and state["adjustment"] is None
    assert len(state["promised"]) == 7 and state["week_start"] == "2026-11-16"


def test_a_goal_is_checked_honestly_and_broken_into_the_week(client: TestClient) -> None:
    commit(client, 19 * 60, 20)
    state = set_goal(
        client, kind="ielts", target="6.5", deadline="2027-06-01", why="учёба", start_level="A2"
    )
    assert state["goal"]["target"] == "6.5" and state["goal"]["why"] == "учёба"
    seen = state["feasibility"]
    assert seen["status"] == "not_possible" and seen["weekly_minutes"] == 100
    assert seen["minutes_a_day_needed"] > 20 and seen["reached_by"] > "2027-06-01"
    skills = {t["skill"]: t for t in state["targets"]}
    assert set(skills) == {"words", "reading", "writing", "speaking"}
    assert sum(t["minutes"] for t in skills.values()) == 100
    # The older screens still read the goal's kind.
    assert client.get("/api/mentor/goal", headers=as_()).json()["goal"] == "ielts"


def test_a_new_goal_ends_the_old_one_and_keeps_it(client: TestClient, db: Session) -> None:
    set_goal(client, kind="travel")
    set_goal(client, kind="business", target="B2")
    goals = db.scalars(select(MentorGoal).order_by(MentorGoal.created_at)).all()
    assert [g.kind for g in goals] == ["travel", "business"]
    assert goals[0].ended_at is not None and goals[1].ended_at is None


def test_bad_goals_are_refused(client: TestClient) -> None:
    for body in (
        {"kind": "fun"},
        {"kind": "ielts", "start_level": "Z9"},
        {"kind": "travel", "x": 1},
    ):
        assert client.put("/api/mentor/coach/goal", json=body, headers=as_()).status_code == 422


def test_the_week_counts_what_was_really_done(client: TestClient, db: Session) -> None:
    set_goal(client, kind="ielts")
    ann = user_of(db)
    for day in (16, 17):  # this week
        db.add(
            WritingSubmission(
                user_id=ann.id,
                client_id=uuid.uuid4(),
                question_id="q",
                answer="x",
                status="done",
                created_at=datetime(2026, 11, day, 18, tzinfo=UTC),
            )
        )
    db.add(  # last week: not this week's
        WritingSubmission(
            user_id=ann.id,
            client_id=uuid.uuid4(),
            question_id="q",
            answer="x",
            status="done",
            created_at=datetime(2026, 11, 12, 18, tzinfo=UTC),
        )
    )
    db.add(
        SpeakingSession(
            user_id=ann.id,
            exercise_type="spontaneous",
            question_id="q",
            status="done",
            completed_at=datetime(2026, 11, 18, 18, tzinfo=UTC),
        )
    )
    db.commit()
    state = coach(client)
    done = {t["skill"]: t["done"] for t in state["targets"]}
    assert done["writing"] == 2 and done["speaking"] == 1 and done["words"] == 0
    assert state["studied"][:4] == [True, True, True, False]


def test_study_times_go_around_the_schedule(client: TestClient) -> None:
    school = {
        "title": "Школа",
        "kind": "school",
        "weekdays": 31,
        "start_minute": 480,
        "end_minute": 840,
    }
    assert client.post("/api/mentor/schedule", json=school, headers=as_()).status_code == 201
    response = client.get(
        "/api/mentor/coach/study-times",
        params={"minutes": 20, "weekdays": WEEKDAYS, "preference": "day"},
        headers=as_(),
    )
    options = response.json()
    assert response.status_code == 200 and options
    for option in options:
        assert not (option["start_minute"] + 20 > 480 - 10 and option["start_minute"] < 840 + 10)
    assert "after_block" in options[0]["reasons"]
    bad = client.get(
        "/api/mentor/coach/study-times", params={"minutes": 20, "weekdays": [9]}, headers=as_()
    )
    assert bad.status_code == 422


def test_the_commitment_is_the_promise_with_a_time(client: TestClient) -> None:
    state = commit(client, 19 * 60, 20).json()
    assert state["commitment"] == {
        "weekdays": WEEKDAYS,
        "start_minute": 19 * 60,
        "minutes": 20,
        "pending_from": None,  # nothing studied yet: it applies at once
    }
    assert state["promised"] == [True] * 5 + [False] * 2
    # Changing only the days, on the older promise screen, keeps the time.
    client.put("/api/me/promise", json={"weekdays": [0, 2, 4]}, headers=as_())
    after = coach(client)["commitment"]
    assert after["weekdays"] == [0, 2, 4] and after["start_minute"] == 19 * 60


def _evenings(db: Session, days: list[int], hour: int) -> None:
    ann = user_of(db)
    for day in days:
        db.add(
            WritingSubmission(
                user_id=ann.id,
                client_id=uuid.uuid4(),
                question_id="q",
                answer="x",
                status="done",
                time_spent_seconds=20 * 60,
                created_at=datetime(2026, 11, day, hour, 5, tzinfo=UTC),
            )
        )
    db.commit()


def test_studying_later_than_promised_brings_a_proposal_to_move_the_time(
    client: TestClient, db: Session
) -> None:
    commit(client, 19 * 60, 20)
    _evenings(db, [16, 17, 18, 19], hour=21)
    adjustment = coach(client, moment=NEXT_MONDAY)["adjustment"]
    assert adjustment["kind"] == "move_time"
    assert adjustment["proposal"]["start"] == 21 * 60
    assert adjustment["evidence"]["kept"] == 4 and adjustment["evidence"]["promised"] == 5

    decided = client.post(
        f"/api/mentor/coach/adjustments/{adjustment['id']}",
        json={"accept": True},
        headers=as_(moment=NEXT_MONDAY),
    ).json()
    assert decided["adjustment"] is None
    assert decided["commitment"]["start_minute"] == 21 * 60
    # Once decided, the same week proposes nothing more.
    assert coach(client, moment=NEXT_MONDAY + timedelta(hours=3))["adjustment"] is None


def test_a_dismissed_proposal_changes_nothing(client: TestClient, db: Session) -> None:
    commit(client, 19 * 60, 20)
    _evenings(db, [16, 17, 18, 19], hour=21)
    adjustment = coach(client, moment=NEXT_MONDAY)["adjustment"]
    after = client.post(
        f"/api/mentor/coach/adjustments/{adjustment['id']}",
        json={"accept": False},
        headers=as_(moment=NEXT_MONDAY),
    ).json()
    assert after["commitment"]["start_minute"] == 19 * 60 and after["adjustment"] is None


def test_a_mostly_missed_week_makes_the_plan_easier(client: TestClient, db: Session) -> None:
    commit(client, 19 * 60, 20)
    _evenings(db, [16], hour=19)
    adjustment = coach(client, moment=NEXT_MONDAY)["adjustment"]
    assert adjustment["kind"] == "easier_minutes" and adjustment["proposal"]["minutes"] == 15


def test_someone_elses_adjustment_cannot_be_decided(client: TestClient, db: Session) -> None:
    commit(client, 19 * 60, 20)
    _evenings(db, [16, 17, 18, 19], hour=21)
    adjustment = coach(client, moment=NEXT_MONDAY)["adjustment"]
    response = client.post(
        f"/api/mentor/coach/adjustments/{adjustment['id']}",
        json={"accept": True},
        headers=as_("bob", NEXT_MONDAY),
    )
    assert response.status_code == 404
