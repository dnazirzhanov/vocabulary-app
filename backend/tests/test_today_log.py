"""The mentor knows what was practised today (the owner's report, 20 November 2026: asked whether
a task was done, it answered «Точных данных … у меня нет»). Its prompt lists each lesson, writing,
speaking and reading of the day from the app's records: what, when, how long, finished or not."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User, WritingSubmission
from app.services import mentor
from app.services.writing import questions as writing_questions
from tests.support import at, finish

BISHKEK = "Asia/Bishkek"  # UTC+6
LUNCH = datetime(2026, 11, 20, 7, 10, tzinfo=UTC)  # 13:10 in Bishkek


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")


def as_(moment: datetime) -> dict[str, str]:
    return {"X-Dev-User": "ann"} | at(moment, BISHKEK)


def prompt_after(client: TestClient, monkeypatch: pytest.MonkeyPatch, moment: datetime) -> str:
    seen: dict[str, Any] = {}
    monkeypatch.setattr(get_settings(), "mentor_chat_demo", False)
    monkeypatch.setattr(get_settings(), "deepseek_api_key", "test-key")

    def record(system: str, *_: Any) -> Any:
        seen["system"] = system
        yield {"delta": "ok"}

    monkeypatch.setattr(mentor, "_stream_with_tools", record)
    client.post(
        "/api/mentor/chat/stream",
        json={"message": "Я успел позаниматься в перерыве?", "new_conversation": True},
        headers=as_(moment),
    )
    return str(seen["system"])


def test_the_mentor_sees_what_was_done_today_and_what_was_left_unfinished(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 13:10–13:18: a whole lesson.
    lesson = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_(LUNCH)
    ).json()
    finish(client, lesson, as_(LUNCH))
    done = client.post(
        f"/api/sessions/{lesson['id']}/complete", headers=as_(LUNCH + timedelta(minutes=8))
    )
    assert done.status_code == 200, done.text
    # 15:00: an essay sent.
    question = writing_questions.QUESTIONS[0]
    ann = db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()
    db.add(
        WritingSubmission(
            user_id=ann.id,
            client_id=uuid.uuid4(),
            question_id=question.id,
            answer="x",
            time_spent_seconds=12 * 60,
            status="pending",
            created_at=LUNCH + timedelta(hours=1, minutes=50),
        )
    )
    db.commit()
    # 16:00: another lesson started and left.
    again = client.post(
        "/api/sessions",
        json={"kind": "study", "deck_id": "a1-a2"},
        headers=as_(LUNCH + timedelta(hours=2, minutes=50)),
    )
    assert again.status_code in (200, 201), again.text

    system = prompt_after(client, monkeypatch, LUNCH + timedelta(hours=3))
    assert "Practice today so far" in system
    assert "  - 13:10–13:18 Words «Основа» (8 min): finished" in system
    assert f"  - 15:00 Writing «{question.title}» (12 min, sent): finished" in system
    assert "  - 16:00 Words «Основа»: started, NOT finished" in system
    assert "never say you have no data about today" in system


def test_a_day_without_practice_says_so_and_writing_counts_as_studying(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.put("/api/me/promise", json={"weekdays": list(range(7))}, headers=as_(LUNCH))
    system = prompt_after(client, monkeypatch, LUNCH)
    assert "Practice today so far: nothing yet" in system
    assert "not yet studied" in system

    ann = db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()
    db.add(
        WritingSubmission(
            user_id=ann.id,
            client_id=uuid.uuid4(),
            question_id=writing_questions.QUESTIONS[0].id,
            answer="x",
            status="done",
            created_at=LUNCH,
        )
    )
    db.commit()
    assert "sessions done ✓" in prompt_after(client, monkeypatch, LUNCH + timedelta(minutes=5))
