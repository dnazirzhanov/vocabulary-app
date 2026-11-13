"""A reading given to a group (Reading Mode, round 2, D): its text, its words as a deck, its
questions and a deadline, in one step."""

from datetime import UTC, date, datetime
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.support import at, named

NOW = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)
WORD = {"headword": "leaf", "pos": "noun", "translation": "лист", "example": "A tea leaf."}
QUESTIONS = [
    {
        "kind": "choice",
        "q": "What is tea made from?",
        "options": ["Leaves", "Beans", "Roots"],
        "answer": 0,
    },
    {"kind": "open", "q": "Why do people drink tea?", "min": 5, "max": 50},
]


def as_(user: str) -> dict[str, str]:
    return {"X-Dev-User": user} | at(NOW)


def group_of(client: TestClient) -> dict[str, Any]:
    """Olga's group, Pavel and Masha in it; Boris is not."""
    group: dict[str, Any] = client.post(
        "/api/groups", json={"name": "7Б"}, headers=named(client, as_("olga"), "Ольга")
    ).json()
    for user, name in (("pavel", "Павел"), ("masha", "Маша")):
        client.post(
            f"/api/groups/join/{group['invite_code']}", headers=named(client, as_(user), name)
        )
    return group


def give(client: TestClient, group_id: str, user: str = "pavel", **fields: Any) -> Any:
    body = {
        "group_id": group_id,
        "reading_ref": "library:tea",
        "words": [WORD],
        "questions": QUESTIONS,
        "due_on": "2026-11-20",
    } | fields
    return client.post("/api/reading-assignments", json=body, headers=as_(user))


def answer(client: TestClient, question: str, user: str, **fields: Any) -> Any:
    op = {
        "op_id": str(uuid4()),
        "kind": "reading.answer",
        "question_ref": question,
        "answered_at": NOW.isoformat(),
    } | fields
    response = client.post(
        "/api/sync/push", json={"ops": [op], "pulled_at": NOW.isoformat()}, headers=as_(user)
    )
    (result,) = response.json()["results"]
    return result


def test_any_member_gives_a_reading_with_its_words_questions_and_deadline(
    client: TestClient,
) -> None:
    group = group_of(client)
    given = give(client, group["id"])
    assert given.status_code == 201, given.text
    out = given.json()
    assert (out["title"], out["group_name"], out["given_by"], out["mine"]) == (
        "Tea",
        "7Б",
        "Павел",
        True,
    )
    assert (out["words"], out["due_on"]) == (1, "2026-11-20")
    assert [q["kind"] for q in out["questions"]] == ["choice", "open"]

    # Every member sees it; the group's owner may take it back, as may its giver.
    seen = client.get("/api/reading-assignments", headers=as_("masha")).json()
    assert [(one["id"], one["mine"], one["can_take_back"]) for one in seen] == [
        (out["id"], False, False)
    ]
    assert client.get("/api/reading-assignments", headers=as_("olga")).json()[0]["can_take_back"]
    assert client.get("/api/reading-assignments", headers=as_("boris")).json() == []

    # Its words are a deck given to the group, listed under «Из чтения» for the members.
    library = client.get("/api/decks/library", headers=as_("masha")).json()
    (deck,) = library["from_groups"]
    assert (deck["id"], deck["reading_ref"], deck["word_count"]) == (
        out["deck_id"],
        f"assignment:{out['id']}",
        1,
    )


def test_members_answer_its_questions_others_cannot(client: TestClient) -> None:
    group = group_of(client)
    out = give(client, group["id"]).json()
    choice, open_ = (q["id"] for q in out["questions"])
    assert answer(client, choice, "masha", choice=0)["status"] == "applied"
    assert answer(client, open_, "masha", text="People like its warm taste.")["status"] == "applied"
    refused = answer(client, open_, "boris", text="People like its warm taste.")
    assert (refused["status"], refused["code"]) == ("rejected", "question_not_found")
    mine = client.get(
        "/api/reading-answers", params={"reading": f"assignment:{out['id']}"}, headers=as_("masha")
    ).json()
    by_question = {a["question_ref"]: (a["choice"], a["correct"]) for a in mine}
    assert by_question == {choice: (0, True), open_: (None, None)}


def test_a_text_of_ones_own_is_readable_by_the_group_it_is_given_to(client: TestClient) -> None:
    group = group_of(client)
    made = client.post(
        "/api/readings",
        json={"title": "The oven", "text": "My grandmother showed me how to bake bread."},
        headers=as_("pavel"),
    ).json()
    url = f"/api/readings/{made['id']}"
    assert client.get(url, headers=as_("masha")).status_code == 404
    give(client, group["id"], reading_ref=f"reading:{made['id']}", words=[])
    shown = client.get(url, headers=as_("masha"))
    assert shown.status_code == 200 and shown.json()["body"] == [
        "My grandmother showed me how to bake bread."
    ]
    # Its own questions stay the author's; the group answers the giving's.
    assert shown.json()["questions"] == []
    assert client.get(url, headers=as_("boris")).status_code == 404
    # Only one's own texts are given.
    other = give(client, group["id"], user="masha", reading_ref=f"reading:{made['id']}")
    assert (other.status_code, other.json()["error"]["code"]) == (404, "reading_not_found")


def test_only_its_giver_or_the_groups_owner_takes_it_back(client: TestClient) -> None:
    group = group_of(client)
    out = give(client, group["id"]).json()
    url = f"/api/reading-assignments/{out['id']}"
    refused = client.delete(url, headers=as_("masha"))
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "not_allowed")
    assert client.delete(url, headers=as_("olga")).status_code == 204
    assert client.get("/api/reading-assignments", headers=as_("masha")).json() == []
    assert client.get(url, headers=as_("masha")).status_code == 404
    # Its deck went with it.
    assert client.get("/api/decks/library", headers=as_("masha")).json()["from_groups"] == []


def test_giving_has_its_rules(client: TestClient) -> None:
    group = group_of(client)
    outsider = give(client, group["id"], user="boris")
    assert outsider.status_code == 404
    unknown = give(client, group["id"], reading_ref="library:nothing-here")
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "reading_not_found")
    past = give(client, group["id"], due_on=str(date(2026, 11, 1)))
    assert (past.status_code, past.json()["error"]["code"]) == (422, "due_in_past")
    bad = give(
        client,
        group["id"],
        questions=[{"kind": "choice", "q": "Which?", "options": ["a"], "answer": 0}],
    )
    assert bad.status_code == 422
    # No words, no deck; no deadline is fine.
    bare = give(client, group["id"], words=[], due_on=None).json()
    assert (bare["deck_id"], bare["words"], bare["due_on"]) == (None, 0, None)


def test_the_giver_and_the_owner_read_the_answers_others_see_who_answered(
    client: TestClient,
) -> None:
    group = group_of(client)
    out = give(client, group["id"]).json()
    choice, open_ = (q["id"] for q in out["questions"])
    answer(client, choice, "masha", choice=1)
    answer(client, open_, "masha", text="People like its warm taste.")
    answer(client, choice, "olga", choice=0)
    url = f"/api/reading-assignments/{out['id']}/answers"

    # Pavel gave it: everyone's answers, right ones counted; me first, then by name.
    seen = client.get(url, headers=as_("pavel")).json()
    assert (seen["may_see"], seen["questions"], seen["choice_questions"], seen["words"]) == (
        True,
        2,
        1,
        1,
    )
    names = [(m["name"], m["me"], m["answered"], m["correct"]) for m in seen["members"]]
    assert names == [("Павел", True, 0, 0), ("Маша", False, 2, 0), ("Ольга", False, 1, 1)]
    masha = seen["members"][1]
    assert [a["question_ref"] for a in masha["answers"]] == [choice, open_]
    assert masha["answers"][1]["text"] == "People like its warm taste."
    assert masha["words_met"] == 0

    # The group's owner too.
    assert client.get(url, headers=as_("olga")).json()["may_see"] is True

    # Masha sees who answered how many, never what.
    plain = client.get(url, headers=as_("masha")).json()
    assert plain["may_see"] is False
    assert [(m["name"], m["answered"], m["correct"], m["answers"]) for m in plain["members"]] == [
        ("Маша", 2, None, []),
        ("Ольга", 1, None, []),
        ("Павел", 0, None, []),
    ]
    # Nobody outside the group.
    assert client.get(url, headers=as_("boris")).status_code == 404
