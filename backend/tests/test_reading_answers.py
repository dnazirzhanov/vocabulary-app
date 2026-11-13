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
# tea's questions: 1–3 with options, 4 and 5 open (30–150 words each).
WHY_DRUNK = "library:tea:4"
# "Why is black tea called red tea in China?": the right option is the fourth (place 3).
WHY_RED = "library:tea:3"
LONG_ENOUGH = (
    "People drink tea in many countries because it is cheap, warm and calming, and because"
    " sharing tea with guests is an old custom in many families and cultures around the world."
)


def as_(user: str, moment: datetime = NOW) -> dict[str, str]:
    return {"X-Dev-User": user} | at(moment)


def words(n: int) -> str:
    return " ".join(["word"] * n)


def send(
    client: TestClient,
    question: str,
    text: str = "",
    user: str = "anna",
    when: datetime = NOW,
    choice: int | None = None,
) -> Any:
    """An answer through the sync outbox, as the app sends it."""
    op = {
        "op_id": str(uuid4()),
        "kind": "reading.answer",
        "question_ref": question,
        "text": text,
        "answered_at": when.isoformat(),
    } | ({} if choice is None else {"choice": choice})
    response = client.post(
        "/api/sync/push", json={"ops": [op], "pulled_at": NOW.isoformat()}, headers=as_(user)
    )
    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    return result


def test_a_question_is_whole() -> None:
    assert Question(q="Why?", min=10, max=60).kind == "open"
    assert Question(q="Which?", options=["a", "b", "c"], answer="c").right == 2
    for bad in (
        {"min": 70, "max": 60},
        {"min": 0, "max": 60},
        {"min": 10, "max": 501},
        {"min": 10},
        {"options": ["a", "b", "c"], "answer": "d"},
        {"options": ["a", "b"], "answer": "a"},
        {"options": ["a", "a", "b"], "answer": "a"},
        {"options": ["a", "b", "c"], "answer": "a", "min": 5, "max": 9},
    ):
        with pytest.raises(ValidationError):
            Question(q="Why?", **bad)


def test_words_are_counted_as_the_reader_counts_them() -> None:
    assert count_words("It's red, because 2 oxides — iron's!") == 5


def test_an_open_answer_within_its_limits_is_kept_with_the_question_it_answered(
    client: TestClient,
) -> None:
    assert send(client, WHY_DRUNK, LONG_ENOUGH)["status"] == "applied"
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["question_ref"] == WHY_DRUNK and got["text"] == LONG_ENOUGH and got["words"] == 31
    assert got["question_text"].startswith("After water, tea is the most popular drink")
    assert got["choice"] is None and got["correct"] is None
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
    short = send(client, WHY_DRUNK, words(29))
    long = send(client, WHY_DRUNK, words(151))
    assert (short["status"], short["code"]) == ("rejected", "answer_too_short")
    assert (long["status"], long["code"]) == ("rejected", "answer_too_long")
    assert send(client, WHY_DRUNK, words(150))["status"] == "applied"
    unknown = send(client, "library:tea:9", words(40))
    assert (unknown["status"], unknown["code"]) == ("rejected", "question_not_found")


def test_a_question_with_options_is_answered_once_right_or_wrong(client: TestClient) -> None:
    # A text is no answer to it, and an open question takes no option.
    assert send(client, WHY_RED, "It looks red.")["code"] == "answer_no_choice"
    assert send(client, WHY_DRUNK, LONG_ENOUGH, choice=1)["code"] == "answer_no_choice"
    assert send(client, WHY_RED, choice=7)["code"] == "answer_no_choice"
    assert send(client, WHY_RED, choice=1)["status"] == "applied"
    # Given once: a second try is refused, the first stays.
    again = send(client, WHY_RED, choice=3, when=NOW + timedelta(minutes=1))
    assert (again["status"], again["code"]) == ("rejected", "answer_final")
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert (got["choice"], got["correct"], got["text"]) == (1, False, "It grows only in red soil")
    assert send(client, WHY_RED, choice=3, user="boris")["status"] == "applied"
    (boris,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("boris")
    ).json()
    assert boris["correct"] is True


def test_an_older_edit_arriving_later_does_not_replace_a_newer_one(client: TestClient) -> None:
    newer = f"The newer answer. {LONG_ENOUGH}"
    send(client, WHY_DRUNK, newer, when=NOW)
    # Written earlier on a phone that was offline, sent only now.
    send(client, WHY_DRUNK, f"An older answer. {LONG_ENOUGH}", when=NOW - timedelta(hours=1))
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["text"] == newer
    # A newer one does.
    send(client, WHY_DRUNK, f"Newest of all. {LONG_ENOUGH}", when=NOW + timedelta(minutes=5))
    (got,) = client.get(
        "/api/reading-answers", params={"reading": "library:tea"}, headers=as_("anna")
    ).json()
    assert got["text"].startswith("Newest of all")


def test_a_text_of_my_own_gets_three_questions_with_options_then_two_open_ones(
    client: TestClient,
) -> None:
    made = client.post(
        "/api/readings",
        json={"title": "The oven", "text": "My grandmother showed me how to bake bread."},
        headers=as_("anna"),
    ).json()
    reading = client.get(f"/api/readings/{made['id']}", headers=as_("anna")).json()
    assert [one["kind"] for one in reading["questions"]] == ["choice"] * 3 + ["open"] * 2
    first, fourth = reading["questions"][0], reading["questions"][3]
    assert first["id"].startswith("question:") and len(first["options"]) == 4
    assert 1 <= fourth["min"] <= fourth["max"] <= 500
    assert send(client, first["id"], choice=first["answer"])["status"] == "applied"
    assert send(client, fourth["id"], "It is about baking bread at home.")["status"] == "applied"
    assert client.get("/api/reading-answers/counts", headers=as_("anna")).json() == {
        f"reading:{made['id']}": 2
    }
    # Someone else can't answer another person's text's question.
    other = send(client, fourth["id"], "It is about baking bread at home.", user="boris")
    assert (other["status"], other["code"]) == ("rejected", "question_not_found")


def test_an_answer_can_be_sent_straight_away_too(client: TestClient) -> None:
    response = client.put(
        "/api/reading-answers",
        json={"question_ref": WHY_DRUNK, "text": LONG_ENOUGH},
        headers=as_("anna"),
    )
    assert response.status_code == 204
    chosen = client.put(
        "/api/reading-answers", json={"question_ref": WHY_RED, "choice": 3}, headers=as_("anna")
    )
    assert chosen.status_code == 204
    too_short = client.put(
        "/api/reading-answers",
        json={"question_ref": WHY_DRUNK, "text": "Red."},
        headers=as_("anna"),
    )
    assert (too_short.status_code, too_short.json()["error"]["code"]) == (422, "answer_too_short")


def test_my_texts_questions_are_mine_to_change_add_and_drop(client: TestClient) -> None:
    made = client.post(
        "/api/readings",
        json={"title": "The oven", "text": "My grandmother showed me how to bake bread."},
        headers=as_("anna"),
    ).json()
    url = f"/api/readings/{made['id']}"
    drafted = client.get(url, headers=as_("anna")).json()["questions"]
    first, fourth = drafted[0], drafted[3]
    assert send(client, fourth["id"], "It is about baking bread at home.")["status"] == "applied"

    # The fourth reworded (its answer stays), a true-or-false one added, the others dropped.
    mine = [
        {
            "id": fourth["id"],
            "kind": "open",
            "q": "What did you learn from her?",
            "min": 3,
            "max": 80,
        },
        {
            "kind": "choice",
            "q": "The bread was baked in an oven.",
            "options": ["True", "False"],
            "answer": 0,
        },
        {
            "id": first["id"],
            "kind": "choice",
            "q": "Who baked?",
            "options": ["Grandmother", "Me", "Nobody"],
            "answer": 0,
        },
    ]
    saved = client.put(f"{url}/questions", json={"questions": mine}, headers=as_("anna"))
    assert saved.status_code == 200, saved.text
    got = saved.json()["questions"]
    assert [q["q"] for q in got] == [
        "What did you learn from her?",
        "The bread was baked in an oven.",
        "Who baked?",
    ]
    assert got[0]["id"] == fourth["id"] and got[2]["id"] == first["id"]
    assert got[1]["options"] == ["True", "False"]
    (kept,) = client.get(
        "/api/reading-answers", params={"reading": f"reading:{made['id']}"}, headers=as_("anna")
    ).json()
    assert kept["question_ref"] == fourth["id"]

    # True or false: marked like any question with options.
    assert send(client, got[1]["id"], choice=1)["status"] == "applied"
    answers = client.get(
        "/api/reading-answers", params={"reading": f"reading:{made['id']}"}, headers=as_("anna")
    ).json()
    assert {a["question_ref"]: a["correct"] for a in answers}[got[1]["id"]] is False

    # Only the owner, and only sound questions.
    other = client.put(f"{url}/questions", json={"questions": mine}, headers=as_("boris"))
    assert other.status_code == 404
    one_option = [{"kind": "choice", "q": "Which?", "options": ["Only"], "answer": 0}]
    bad = client.put(f"{url}/questions", json={"questions": one_option}, headers=as_("anna"))
    assert bad.status_code == 422
