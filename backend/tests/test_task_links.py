"""A group task's material (ADR 0096): the teacher links a deck, a reading, an essay question, a
speaking question or a shadowing exercise; members see it on the task, may open it, and doing it
ticks the task «по занятию» that day."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ShadowingAttempt,
    ShadowingExercise,
    SpeakingSession,
    User,
    WritingSubmission,
)
from tests.support import at, finish, named

MONDAY = datetime(2026, 11, 23, 10, 0, tzinfo=UTC)
D = date(2026, 11, 23)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MONDAY)


def class_with(client: TestClient, *students: str) -> dict[str, Any]:
    made = client.post(
        "/api/groups", json={"name": "7Б"}, headers=named(client, as_("olga"), "Ольга")
    )
    group: dict[str, Any] = made.json()
    for student in students:
        client.post(
            f"/api/groups/join/{group['invite_code']}",
            headers=named(client, as_(student), student.capitalize()),
        )
    return group


def give(client: TestClient, group: dict[str, Any], **body: Any) -> Any:
    return client.post(f"/api/groups/{group['id']}/tasks", json=body, headers=as_("olga"))


def today(client: TestClient, who: str) -> dict[str, dict[str, Any]]:
    got = client.get(
        "/api/tasks", params={"start": D.isoformat(), "end": D.isoformat()}, headers=as_(who)
    ).json()
    return {i["task"]["title"]: i for i in got["items"]}


def user(db: Session, name: str) -> User:
    return db.scalars(select(User).where(User.auth_subject.endswith(name))).one()


def test_a_linked_deck_is_given_to_the_group_and_a_lesson_on_it_ticks_the_task(
    client: TestClient,
) -> None:
    group = class_with(client, "masha")
    made = give(
        client,
        group,
        title="Учить новые слова",
        repeat_mask=127,
        link={"kind": "deck", "ref": "a1-a2"},
    )
    assert made.status_code == 201, made.text
    assert made.json()["link"]["kind"] == "deck" and made.json()["link"]["ref"] == "a1-a2"
    # The student sees the material on the task, and has the deck as the group's.
    item = today(client, "masha")["Учить новые слова"]
    assert item["task"]["link"]["title"] and item["state"] is None
    library = client.get("/api/decks/library", headers=as_("masha")).json()
    assert "a1-a2" in [d["id"] for d in library["from_groups"]]

    # A lesson finished on that deck: ticked «по занятию», on the board too.
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_("masha")
    ).json()
    finish(client, session, as_("masha"))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_("masha"))
    item = today(client, "masha")["Учить новые слова"]
    assert (item["state"], item["by_practice"]) == ("done", True)
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    masha = next(r["member_id"] for r in board["rows"] if r["name"] == "Masha")
    assert board["tasks"][0]["marks"][masha][0] == "done"


def test_writing_speaking_and_shadowing_tick_by_doing(client: TestClient, db: Session) -> None:
    group = class_with(client, "masha")
    exercise = ShadowingExercise(
        slug="anna-day",
        title="Anna's First Day",
        description="",
        difficulty="beginner",
        duration_ms=1000,
        transcript="Hi.",
        sentences=[],
        audio_path="",
        is_active=True,
    )
    db.add(exercise)
    db.commit()
    for title, link in (
        ("Эссе", {"kind": "writing", "ref": "ielts-edu-1"}),
        ("Ответить", {"kind": "speaking", "ref": "spon-hometown"}),
        ("Шэдоуинг", {"kind": "shadowing", "ref": str(exercise.id)}),
    ):
        made = give(client, group, title=title, due_on=D.isoformat(), link=link)
        assert made.status_code == 201, made.text
    assert {k: v["state"] for k, v in today(client, "masha").items()} == {
        "Эссе": None,
        "Ответить": None,
        "Шэдоуинг": None,
    }
    masha = user(db, "masha")
    db.add_all(
        [
            WritingSubmission(
                id=uuid.uuid4(),
                user_id=masha.id,
                client_id=uuid.uuid4(),
                question_id="ielts-edu-1",
                answer="An essay.",
                feedback_language="ru",
                status="done",
                created_at=MONDAY,
            ),
            SpeakingSession(
                id=uuid.uuid4(),
                user_id=masha.id,
                exercise_type="spontaneous",
                question_id="spon-hometown",
                status="done",
                started_at=MONDAY,
                completed_at=MONDAY,
            ),
            ShadowingAttempt(
                id=uuid.uuid4(),
                user_id=masha.id,
                exercise_id=exercise.id,
                completed_at=MONDAY,
                created_at=MONDAY,
            ),
        ]
    )
    db.commit()
    done = today(client, "masha")
    assert {k: (v["state"], v["by_practice"]) for k, v in done.items()} == {
        "Эссе": ("done", True),
        "Ответить": ("done", True),
        "Шэдоуинг": ("done", True),
    }


def test_a_linked_reading_is_given_once(client: TestClient) -> None:
    group = class_with(client, "masha")
    link = {"kind": "reading", "ref": "library:internet"}
    first = give(client, group, title="Прочитать", due_on=D.isoformat(), link=link)
    assert first.status_code == 201, first.text
    assert first.json()["link"]["title"]
    again = give(client, group, title="Ещё раз", due_on=D.isoformat(), link=link)
    assert again.status_code == 201
    given = client.get("/api/reading-assignments", headers=as_("masha")).json()
    assert [a["reading_ref"] for a in given].count("library:internet") == 1


def test_bad_links_are_refused(client: TestClient) -> None:
    group = class_with(client, "masha")
    for link in (
        {"kind": "writing", "ref": "no-such-question"},
        {"kind": "speaking", "ref": "no-such-question"},
        {"kind": "shadowing", "ref": str(uuid.uuid4())},
        {"kind": "shadowing", "ref": "not-an-id"},
        {"kind": "deck", "ref": "g-no-such-deck"},
    ):
        made = give(client, group, title="x", due_on=D.isoformat(), link=link)
        assert made.status_code == 404, (link, made.text)
    assert give(client, group, title="x", link={"kind": "essay", "ref": "x"}).status_code == 422
    # A task of one's own has no material: it is a group's teacher who links.
    own = client.post(
        "/api/tasks",
        json={"title": "x", "link": {"kind": "writing", "ref": "ielts-edu-1"}},
        headers=as_("masha"),
    )
    assert own.status_code == 422


def test_a_linked_speaking_question_opens_for_a_student_who_isnt_a_tester(
    client: TestClient,
) -> None:
    group = class_with(client, "masha", "petya")
    # Before any link: speaking is closed to a student who isn't a tester.
    assert client.get("/api/speaking/questions", headers=as_("masha")).status_code == 403
    # The teacher may list every question, to pick one.
    every = client.get("/api/speaking/questions", headers=as_("olga")).json()
    assert len(every) > 1
    give(
        client,
        group,
        title="Ответить",
        due_on=(D + timedelta(days=1)).isoformat(),
        link={"kind": "speaking", "ref": "spon-hometown"},
    )
    mine = client.get("/api/speaking/questions", headers=as_("masha")).json()
    assert [q["id"] for q in mine] == ["spon-hometown"]
    body = {"exercise_type": "spontaneous", "question_id": "spon-hometown"}
    assert client.post("/api/speaking/sessions", json=body, headers=as_("masha")).status_code in (
        200,
        201,
    )
    other = {"exercise_type": "spontaneous", "question_id": "spon-food"}
    refused = client.post("/api/speaking/sessions", json=other, headers=as_("masha"))
    assert refused.status_code == 403
