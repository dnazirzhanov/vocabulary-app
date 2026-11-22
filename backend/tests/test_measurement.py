"""Whether the mentor works (ADR 0078): what is recorded about each answer and each «Начать»,
and the weekly metrics read from it, the timeline, the promise and the practice."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import MentorEvent, User, WritingSubmission
from app.services import mentor, mentor_metrics
from tests.support import at

THURSDAY = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(moment: datetime = THURSDAY, name: str = "ann") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def user(db: Session, name: str = "ann") -> User:
    return db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()


def wrote(db: Session, moment: datetime, name: str = "ann") -> None:
    db.add(
        WritingSubmission(
            user_id=user(db, name).id,
            client_id=uuid.uuid4(),
            question_id="q",
            answer="x",
            status="done",
            created_at=moment,
        )
    )
    db.commit()


def tapped(client: TestClient, moment: datetime, name: str = "ann") -> None:
    response = client.post(
        "/api/mentor/events",
        json={"name": "start_tapped", "kind": "vocab", "where": "home"},
        headers=as_(moment, name),
    )
    assert response.status_code == 204, response.text


# --- what is recorded -----------------------------------------------------------------------


def test_each_answer_is_timed_with_its_tools(client: TestClient, db: Session) -> None:
    client.post(
        "/api/mentor/chat/stream",
        json={"message": "Как выглядит мой день?", "new_conversation": True},
        headers=as_(),
    )
    event = db.scalars(select(MentorEvent)).one()
    assert event.name == "chat_message" and event.at == THURSDAY
    assert event.props["tools"] == ["show"] and event.props["demo"] is True
    assert 0 <= event.props["first_ms"] <= event.props["total_ms"]


def test_token_use_adds_up_across_rounds_in_either_form() -> None:
    stats: dict[str, int] = {}
    deepseek = SimpleNamespace(
        prompt_tokens=1000, completion_tokens=50, prompt_cache_hit_tokens=800
    )
    openai = SimpleNamespace(
        prompt_tokens=1200,
        completion_tokens=70,
        prompt_tokens_details=SimpleNamespace(cached_tokens=1000),
    )
    mentor._count_usage(stats, deepseek)
    mentor._count_usage(stats, openai)
    assert stats == {
        "prompt_tokens": 2200,
        "completion_tokens": 120,
        "cached_tokens": 1800,
        "rounds": 2,
    }


def test_the_app_records_only_a_start_tapped(client: TestClient, db: Session) -> None:
    tapped(client, THURSDAY)
    assert db.scalars(select(MentorEvent)).one().props == {"kind": "vocab", "where": "home"}
    bad = client.post(
        "/api/mentor/events",
        json={"name": "chat_message", "kind": "vocab", "where": "home"},
        headers=as_(),
    )
    assert bad.status_code == 422


# --- the weekly metrics ---------------------------------------------------------------------


def test_a_week_is_read_from_what_happened(client: TestClient, db: Session) -> None:
    # Promised every day from the week before; this week Monday 16 – Thursday 19 so far.
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": 1140, "minutes": 20},
        headers=as_(datetime(2026, 11, 9, 9, tzinfo=UTC)),
    )
    wrote(db, datetime(2026, 11, 17, 19, tzinfo=UTC))
    tapped(client, datetime(2026, 11, 18, 18, tzinfo=UTC))
    wrote(db, datetime(2026, 11, 18, 18, 30, tzinfo=UTC))  # finished after the tap
    tapped(client, datetime(2026, 11, 19, 8, tzinfo=UTC))  # nothing after this one
    client.put("/api/mentor/coach/today", json={"mode": "minimum"}, headers=as_())
    client.post(
        "/api/mentor/memory/facts",
        json={"kind": "why", "text": "Хочет в Канаду", "source": "chat"},
        headers=as_(),
    )
    for prompt, cached, first in ((1000, 800, 900), (1000, 200, 1500)):
        db.add(
            MentorEvent(
                user_id=user(db).id,
                at=THURSDAY,
                name="chat_message",
                props={
                    "first_ms": first,
                    "total_ms": first + 1000,
                    "prompt_tokens": prompt,
                    "cached_tokens": cached,
                    "demo": False,
                },
            )
        )
    db.commit()

    weeks = mentor_metrics.weekly(db, THURSDAY, weeks=2)
    assert [w.week_start for w in weeks] == [date(2026, 11, 9), date(2026, 11, 16)]
    week = weeks[-1]
    assert (week.mentor_users, week.promised_days, week.kept_days) == (1, 4, 2)
    assert (week.starts, week.starts_finished) == (2, 1)
    assert (week.answers, week.first_ms_median, week.total_ms_median) == (2, 1200, 2200)
    assert week.cache_share == 0.5
    assert week.rescues == {"minimum": 1} and week.facts_saved == 1
    assert week.new_users == 0 and weeks[0].new_users == 1  # first used the week before


def test_retention_counts_only_once_its_days_have_passed(client: TestClient, db: Session) -> None:
    first = datetime(2026, 10, 28, 9, tzinfo=UTC)
    tapped(client, first, "bob")
    wrote(db, first + timedelta(days=8), "bob")  # within days 7–13
    weeks = mentor_metrics.weekly(db, THURSDAY, weeks=4)
    cohort = next(w for w in weeks if w.week_start == date(2026, 10, 26))
    assert cohort.new_users == 1
    assert (cohort.d7.eligible, cohort.d7.retained) == (1, 1)
    assert cohort.d30.eligible == 0  # 27 November hasn't come yet
    assert "2026-10-26" in mentor_metrics.table(weeks)


def test_the_metrics_need_the_schedulers_secret(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "reminders_token", "s3cret")
    assert client.get("/api/internal/mentor-metrics").status_code in (401, 403, 404)
    wrong = client.get("/api/internal/mentor-metrics", headers={"X-Reminders-Token": "nope"})
    assert wrong.status_code in (401, 403, 404)
    ok = client.get(
        "/api/internal/mentor-metrics",
        params={"weeks": 2},
        headers={"X-Reminders-Token": "s3cret", "X-Dev-Now": THURSDAY.isoformat()},
    )
    assert ok.status_code == 200, ok.text
    body: list[dict[str, Any]] = ok.json()
    assert [w["week_start"] for w in body] == ["2026-11-09", "2026-11-16"]
    assert json.dumps(body)  # plain JSON throughout
