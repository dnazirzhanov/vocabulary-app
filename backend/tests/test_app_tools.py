"""The app as tools (ADR 0079): the mentor looks up any part of the app (the learner's own data,
facts only, bounded arguments) and proposes changes, such as reminders, that apply on a tap."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    SpeakingAssessment,
    SpeakingAudioAsset,
    SpeakingFeedbackItem,
    SpeakingSession,
    User,
    UserWordProgress,
    WritingSubmission,
)
from app.services import mentor_tools
from app.services.writing import questions as writing_questions
from tests.support import at, finish

BISHKEK = ZoneInfo("Asia/Bishkek")
NOW = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)  # Friday 15:00 in Bishkek


@pytest.fixture(autouse=True)
def mentors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mentor_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_demo_stream_delay_ms", 0)


def as_(moment: datetime = NOW, name: str = "ann") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, "Asia/Bishkek")


def learner(db: Session, client: TestClient, name: str = "ann") -> User:
    client.get("/api/me", headers=as_(name=name))
    return db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()


def call(db: Session, client: TestClient, tool: str, name: str = "ann", **args: Any) -> Any:
    ctx = mentor_tools.ToolContext(db, learner(db, client, name), NOW, BISHKEK, [])
    result = mentor_tools.run(tool, ctx, args)
    json.dumps(result.result, default=str)  # what the model is told is plain JSON
    return result


def lesson(client: TestClient, moment: datetime, minutes: int = 6) -> None:
    started = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_(moment)
    ).json()
    finish(client, started, as_(moment))
    client.post(
        f"/api/sessions/{started['id']}/complete", headers=as_(moment + timedelta(minutes=minutes))
    )


# --- practice -------------------------------------------------------------------------------


def test_practice_on_other_days_with_bounded_dates(client: TestClient, db: Session) -> None:
    lesson(client, NOW - timedelta(days=1))  # Thursday 15:00
    found = call(db, client, "get_practice", **{"from": "yesterday", "to": "yesterday"}).result
    assert found["days"] == {
        "2026-11-19": [
            {
                "time": "15:00–15:06",
                "what": "Words",
                "title": "Основа",
                "minutes": 6,
                "finished": True,
            }
        ]
    }
    assert found["days_practised"] == 1
    week = call(db, client, "get_practice").result
    assert (week["from"], week["to"]) == ("2026-11-14", "2026-11-20")
    far = call(db, client, "get_practice", **{"from": "2025-01-01", "to": "2027-01-01"}).result
    assert far["to"] == "2026-11-20" and far["from"] == "2026-10-21"  # 31 days, not the future
    wrong = call(db, client, "get_practice", **{"from": "today", "to": "yesterday"}).result
    assert "error" in wrong


# --- words ----------------------------------------------------------------------------------


def test_struggling_words_come_first_by_how_often_they_were_forgotten(
    client: TestClient, db: Session
) -> None:
    lesson(client, NOW - timedelta(days=3))
    ann = learner(db, client)
    rows = db.scalars(select(UserWordProgress).where(UserWordProgress.user_id == ann.id)).all()
    db.execute(
        update(UserWordProgress)
        .where(UserWordProgress.user_id == ann.id, UserWordProgress.word_id == rows[0].word_id)
        .values(lapses=3)
    )
    db.execute(
        update(UserWordProgress)
        .where(UserWordProgress.user_id == ann.id, UserWordProgress.word_id == rows[1].word_id)
        .values(lapses=1)
    )
    db.commit()
    found = call(db, client, "get_words", state="struggling").result
    assert [w["forgotten"] for w in found["words"]] == [3, 1]
    assert found["counts"]["struggling"] == 2 and found["counts"]["new"] == len(rows)
    assert all(w["word"] and w["translation"] for w in found["words"])
    assert call(db, client, "get_words", state="nonsense", limit="x").result["state"] == "due"
    # Another learner's words are never seen.
    assert call(db, client, "get_words", name="bob", state="new").result["words"] == []


# --- writing and speaking -------------------------------------------------------------------


def test_essays_come_with_their_feedback(client: TestClient, db: Session) -> None:
    question = writing_questions.QUESTIONS[0]
    db.add(
        WritingSubmission(
            user_id=learner(db, client).id,
            client_id=uuid.uuid4(),
            question_id=question.id,
            answer="I wake up at seven and go to school",
            status="done",
            created_at=NOW - timedelta(days=2),
            evaluation={
                "cefr_level": "A2",
                "overall": 3,
                "criteria": {
                    "task": {"score": 4, "comment": ""},
                    "grammar": {"score": 2, "comment": ""},
                },
                "summary": "Clear, but the verbs need work.",
                "improvements": ["Use past tense", "Link ideas", "Check articles", "More"],
                "corrections": [{"original": "a", "suggestion": "b"}],
            },
        )
    )
    db.commit()
    essay = call(db, client, "get_writing").result["essays"][0]
    assert essay == {
        "date": "2026-11-18",
        "question": question.title,
        "status": "done",
        "words": 9,
        "level": "A2",
        "overall": 3,
        "scores": {"task": 4, "grammar": 2},
        "summary": "Clear, but the verbs need work.",
        "improve": ["Use past tense", "Link ideas", "Check articles"],
        "mistakes": 1,
    }
    assert call(db, client, "get_writing", name="bob").result == {"essays": [], "total": 0}


def test_speaking_comes_with_scores_and_corrections(client: TestClient, db: Session) -> None:
    ann = learner(db, client)
    session = SpeakingSession(
        user_id=ann.id,
        exercise_type="spontaneous",
        question_id="q1",
        status="done",
        started_at=NOW - timedelta(hours=2),
        completed_at=NOW - timedelta(hours=2) + timedelta(minutes=1),
    )
    db.add(session)
    db.flush()
    asset = SpeakingAudioAsset(
        session_id=session.id,
        storage_mode="local",
        storage_path="x.webm",
        mime_type="audio/webm",
        byte_size=1,
        uploaded_at=NOW,
        expires_at=NOW + timedelta(days=30),
    )
    db.add(asset)
    db.flush()
    assessment = SpeakingAssessment(
        session_id=session.id,
        audio_asset_id=asset.id,
        transcript="I goed to school",
        transcript_words=[],
        pronunciation_score=71.6,
        fluency_score=64.2,
        overall_score=68.0,
        evidence={},
    )
    db.add(assessment)
    db.flush()
    db.add(
        SpeakingFeedbackItem(
            assessment_id=assessment.id,
            category="grammar",
            severity="major",
            original_text="I goed",
            corrected_text="I went",
            explanation="go → went",
        )
    )
    db.commit()
    found = call(db, client, "get_speaking").result["sessions"]
    assert found == [
        {
            "date": "2026-11-20",
            "exercise": "spontaneous",
            "scores": {"overall": 68, "pronunciation": 72, "fluency": 64},
            "corrections": [
                {"kind": "grammar", "said": "I goed", "better": "I went", "why": "go → went"}
            ],
        }
    ]


# --- a date, a period, group decks ----------------------------------------------------------


def test_a_dates_calendar_and_the_weeks_progress(client: TestClient, db: Session) -> None:
    client.put(
        "/api/mentor/coach/commitment",
        json={"weekdays": list(range(7)), "start_minute": 1140, "minutes": 20},
        headers=as_(NOW - timedelta(days=10)),
    )
    client.post(
        "/api/mentor/schedule",
        json={
            "title": "Школа",
            "kind": "school",
            "weekdays": 31,
            "start_minute": 480,
            "end_minute": 840,
        },
        headers=as_(),
    )
    lesson(client, NOW - timedelta(days=1))
    lesson(client, NOW - timedelta(days=3))
    monday = call(db, client, "get_calendar", date="2026-11-23").result
    assert monday == {
        "date": "2026-11-23",
        "weekday": "Monday",
        "blocks": [{"title": "Школа", "kind": "school", "start": "08:00", "end": "14:00"}],
        "kind_of_day": None,
        "changed": None,
        "promised": True,
        "study_time": "19:00, 20 min",
    }
    assert "error" in call(db, client, "get_calendar", date="2027-06-01").result
    week = call(db, client, "get_progress", period="week").result
    assert week["period"] == "2026-11-14 to 2026-11-20"
    assert (week["days_practised"], week["lessons"], week["promised_days"]) == (2, 2, 7)
    assert week["promised_days_kept"] == 2 and week["reviews"] > 0


def test_no_group_decks_means_an_empty_list(client: TestClient, db: Session) -> None:
    assert call(db, client, "get_assignments").result == {"assignments": []}


# --- proposals and the chat -----------------------------------------------------------------


def test_reminders_are_proposed_only_where_they_would_change(
    client: TestClient, db: Session
) -> None:
    same = call(db, client, "propose_reminders", morning=True)
    assert same.card is None and same.result["why"] == "already so"
    off = call(db, client, "propose_reminders", afternoon=False, morning=True, report="yes")
    assert off.card == {"type": "reminders", "changes": {"afternoon": False}}
    assert learner(db, client).notify_afternoon is True  # nothing saved before the tap


def test_a_lookup_streams_as_a_step_without_a_card(client: TestClient) -> None:
    response = client.post(
        "/api/mentor/chat/stream",
        json={"message": "Что я делал вчера?", "new_conversation": True},
        headers=as_(),
    )
    events = [json.loads(x[6:]) for x in response.text.split("\n\n") if x.startswith("data: ")]
    tools = [e["tool"] for e in events if "tool" in e]
    assert [(t["name"], t["status"]) for t in tools][:2] == [
        ("get_practice", "running"),
        ("get_practice", "done"),
    ]
    assert tools[1].get("card") is None


def test_every_tool_the_model_is_offered_can_run() -> None:
    offered = {tool["function"]["name"] for tool in mentor_tools.TOOLS}
    assert offered == set(mentor_tools.RUNNERS)
