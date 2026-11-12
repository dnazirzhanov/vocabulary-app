"""Answers to comprehension questions (Reading Mode, round 2, C)."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.services.reading import Question
from app.services.reading_answers import count_words
from tests.support import at

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)
# tea's questions: 1 (20–100 words), 2 (10–60), 3 (20–120).
WHY_RED = "library:tea:2"


def as_(user: str, moment: datetime = NOW) -> dict[str, str]:
    return {"X-Dev-User": user} | at(moment)


def words(n: int) -> str:
    return " ".join(["word"] * n)


def send(
    client: TestClient, question: str, text: str, user: str = "anna", when: datetime = NOW
) -> Any:
    """An answer through the sync outbox, as the app sends it."""
    op = {
        "op_id": str(uuid4()),
        "kind": "reading.answer",
        "question_ref": question,
        "text": text,
        "answered_at": when.isoformat(),
    }
    response = client.post(
        "/api/sync/push", json={"ops": [op], "pulled_at": NOW.isoformat()}, headers=as_(user)
    )
    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    return result


def test_a_question_has_sound_limits() -> None:
    assert Question(q="Why?", min=10, max=60).max == 60
    for bad in ({"min": 70, "max": 60}, {"min": 0, "max": 60}, {"min": 10, "max": 501}):
        with pytest.raises(ValidationError):
            Question(q="Why?", **bad)


def test_words_are_counted_as_the_reader_counts_them() -> None:
    assert count_words("It's red, because 2 oxides — iron's!") == 5


def test_an_answer_within_its_limits_is_kept_with_the_question_it_answered(
    client: TestClient,
) -> None:
    text = "Because the leaves look deep dark red in boiling water."
    assert send(client, WHY_RED, text)["status"] == "applied"
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["question_ref"] == WHY_RED and got["text"] == text and got["words"] == 10
    assert got["question_text"] == 'Why is black tea also called "red tea" in China?'
    assert client.get("/api/reading-answers/counts", headers=as_("anna")).json() == {
        "library:tea": 1
    }
    # Nobody else sees it.
    assert (
        client.get(
            "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("boris")
        ).json()
        == []
    )


def test_limits_hold_and_no_answer_is_over_500_words(client: TestClient) -> None:
    short = send(client, WHY_RED, words(9))
    long = send(client, WHY_RED, words(61))
    assert (short["status"], short["code"]) == ("rejected", "answer_too_short")
    assert (long["status"], long["code"]) == ("rejected", "answer_too_long")
    assert send(client, WHY_RED, words(60))["status"] == "applied"
    unknown = send(client, "library:tea:9", words(20))
    assert (unknown["status"], unknown["code"]) == ("rejected", "question_not_found")


def test_an_older_edit_arriving_later_does_not_replace_a_newer_one(client: TestClient) -> None:
    send(client, WHY_RED, "The newer answer: the brewed tea itself looks red in the cup.", when=NOW)
    # Written earlier on a phone that was offline, sent only now.
    send(
        client,
        WHY_RED,
        "An older answer: it was called red tea once upon a time, long ago.",
        when=NOW - timedelta(hours=1),
    )
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["text"] == "The newer answer: the brewed tea itself looks red in the cup."
    # A newer one does.
    send(
        client,
        WHY_RED,
        "Newest of all: brewed black tea looks deep dark red in the cup.",
        when=NOW + timedelta(minutes=5),
    )
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["text"].startswith("Newest of all")


def test_a_text_of_my_own_gets_questions_only_i_answer(client: TestClient) -> None:
    made = client.post(
        "/api/readings",
        json={"title": "The oven", "text": "My grandmother showed me how to bake bread."},
        headers=as_("anna"),
    ).json()
    reading = client.get(f"/api/readings/{made['id']}", headers=as_("anna")).json()
    assert len(reading["questions"]) == 3
    first = reading["questions"][0]
    assert first["id"].startswith("question:") and 1 <= first["min"] <= first["max"] <= 500
    assert send(client, first["id"], "It is about baking bread at home.")["status"] == "applied"
    assert client.get("/api/reading-answers/counts", headers=as_("anna")).json() == {
        f"reading:{made['id']}": 1
    }
    # Someone else can't answer another person's text's question.
    other = send(client, first["id"], "It is about baking bread at home.", user="boris")
    assert (other["status"], other["code"]) == ("rejected", "question_not_found")


def test_an_answer_can_be_sent_straight_away_too(client: TestClient) -> None:
    response = client.put(
        "/api/reading-answers",
        json={
            "question_ref": WHY_RED,
            "text": "It looks deep dark red when the leaves are brewed in water.",
        },
        headers=as_("anna"),
    )
    assert response.status_code == 204
    too_short = client.put(
        "/api/reading-answers", json={"question_ref": WHY_RED, "text": "Red."}, headers=as_("anna")
    )
    assert (too_short.status_code, too_short.json()["error"]["code"]) == (422, "answer_too_short")
