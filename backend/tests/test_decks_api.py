"""Teachers' decks through the API (ADR 0017): written by a group's owner, given to the group, met
by its members first within their own daily pace, never counted toward the course goal."""

from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserWordProgress
from tests.support import at, cards, finish

THURSDAY = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
CONTINUE = {"kind": "study"}  # «Продолжить»: every level's reviews, then the day's new words

SETBACK = {
    "headword": "setback",
    "pos": "noun",
    "translation": "неудача",
    "example": "The rain was a setback for the team.",
}
CARRY_OUT = {
    "headword": "carry out",
    "pos": "phrase",
    "translation": "проводить, выполнять",
    "example": "They carried out the experiment.",
    "example_ru": "Они провели эксперимент.",
}
# A course word: linked, so its course content stands.
MONEY = {"headword": "money", "pos": "noun", "translation": "деньги", "example": "No money."}


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(THURSDAY)


def class_group(client: TestClient) -> dict[str, Any]:
    """Olga's class, with Pavel and Ivan in it."""
    group: dict[str, Any] = client.post(
        "/api/groups", json={"name": "7Б английский", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    for user, nickname in (("pavel", "Павел"), ("ivan", "Иван")):
        client.post(
            f"/api/groups/join/{group['invite_code']}",
            json={"nickname": nickname},
            headers=as_(user),
        )
    return group


def write_deck(
    client: TestClient, group_id: str, words: list[dict[str, str]], title: str = "Unit 4"
) -> dict[str, Any]:
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": title}, headers=as_("olga")
    ).json()
    for word in words:
        response = client.post(f"/api/decks/{deck['id']}/words", json=word, headers=as_("olga"))
        assert response.status_code == 201, response.text
        deck = response.json()
    return deck


def give(client: TestClient, deck: dict[str, Any], group_id: str) -> dict[str, Any]:
    response = client.post(
        f"/api/decks/{deck['id']}/publish", json={"group_id": group_id}, headers=as_("olga")
    )
    assert response.status_code == 200, response.text
    published: dict[str, Any] = response.json()
    return published


def new_words(client: TestClient, user: str) -> list[str]:
    """The new words of the user's next lesson, in order (the lesson is left open)."""
    session = client.post("/api/sessions", json=CONTINUE, headers=as_(user)).json()
    return [card["word"]["headword"] for card in cards(session) if card["new"]]


def learn(client: TestClient, user: str) -> None:
    """One whole lesson for `user`, every card «Хорошо»."""
    session = client.post("/api/sessions", json=CONTINUE, headers=as_(user)).json()
    finish(client, session, as_(user))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(user))


def test_anyone_writes_a_deck_only_a_groups_owner_gives_it(client: TestClient) -> None:
    group = class_group(client)
    # Pavel writes a deck of his own, but the group isn't his to give words to.
    pavels = client.post("/api/decks", json={"title": "Мой"}, headers=as_("pavel")).json()
    client.post(f"/api/decks/{pavels['id']}/words", json=SETBACK, headers=as_("pavel"))
    member = client.post(
        f"/api/decks/{pavels['id']}/publish", json={"group_id": group["id"]}, headers=as_("pavel")
    )
    assert (member.status_code, member.json()["error"]["code"]) == (403, "not_group_owner")
    stranger = client.post("/api/decks", json={"title": "Чужой"}, headers=as_("stranger")).json()
    client.post(f"/api/decks/{stranger['id']}/words", json=SETBACK, headers=as_("stranger"))
    outside = client.post(
        f"/api/decks/{stranger['id']}/publish",
        json={"group_id": group["id"]},
        headers=as_("stranger"),
    )
    assert outside.status_code == 404

    deck = write_deck(client, group["id"], [])
    assert deck["status"] == "draft" and deck["groups"] == []
    # Someone else's deck does not exist for them.
    assert client.get(f"/api/decks/{deck['id']}/edit", headers=as_("pavel")).status_code == 404
    assert (
        client.post(f"/api/decks/{deck['id']}/words", json=SETBACK, headers=as_("pavel"))
    ).status_code == 404
    assert (
        client.post(
            f"/api/decks/{deck['id']}/publish", json={"group_id": group["id"]}, headers=as_("pavel")
        )
    ).status_code == 404
    empty = client.post(
        f"/api/decks/{deck['id']}/publish", json={"group_id": group["id"]}, headers=as_("olga")
    )
    assert (empty.status_code, empty.json()["error"]["code"]) == (409, "deck_empty")
    # A draft is nobody's lesson, not even the browsing of its group's members.
    assert client.get(f"/api/decks/{deck['id']}/words", headers=as_("pavel")).status_code == 404
    assert [d["id"] for d in client.get("/api/decks/mine", headers=as_("olga")).json()] == [
        deck["id"]
    ]


def test_a_course_word_is_linked_not_copied(client: TestClient) -> None:
    group = class_group(client)
    deck = write_deck(client, group["id"], [MONEY, SETBACK])
    money, setback = deck["words"]
    assert money["from_course"] and not setback["from_course"]
    assert money["word"]["id"] == "money"  # the course's own word, with its own content
    assert setback["word"]["id"].startswith("t-")

    edit = client.put(
        f"/api/decks/{deck['id']}/words/money",
        json=MONEY | {"translation": "x"},
        headers=as_("olga"),
    )
    assert (edit.status_code, edit.json()["error"]["code"]) == (409, "course_word")
    twice = client.post(
        f"/api/decks/{deck['id']}/words",
        json=SETBACK | {"headword": " Setback "},
        headers=as_("olga"),
    )
    assert (twice.status_code, twice.json()["error"]["code"]) == (409, "word_in_deck")
    for bad in ("carry  out", "naïve", "two words!", ""):
        response = client.post(
            f"/api/decks/{deck['id']}/words", json=SETBACK | {"headword": bad}, headers=as_("olga")
        )
        assert response.status_code == 422, bad


def test_given_words_come_first_within_the_learners_own_pace(client: TestClient) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    assert deck["status"] == "published" and deck["groups"][0]["name"] == "7Б английский"
    # Giving it again changes nothing.
    assert give(client, deck, group["id"])["groups"] == deck["groups"]

    listed = client.get("/api/decks", headers=as_("pavel")).json()
    given = listed[0]
    assert (given["kind"], given["word_count"]) == ("group", 3)
    # Where it comes from: the group, and its author's nickname there.
    assert (given["group_name"], given["author"], given["is_mine"]) == (
        "7Б английский",
        "Ольга",
        False,
    )
    # Today's five new words: the teacher's three, then two of the course (money only once).
    assert [(d["kind"], d["new_today"]) for d in listed[:2]] == [("group", 3), ("course", 2)]
    assert new_words(client, "pavel") == ["setback", "carry out", "money", "house", "water"]

    # Whoever gave the words is a member too: the deck is hers to learn, at her own pace.
    hers = client.get("/api/decks", headers=as_("olga")).json()[0]
    assert (hers["kind"], hers["author"], hers["is_mine"]) == ("group", "Ольга", True)
    assert new_words(client, "olga") == ["setback", "carry out", "money", "house", "water"]


def test_a_phrase_is_spelled_with_its_gaps(client: TestClient) -> None:
    group = class_group(client)
    give(client, write_deck(client, group["id"], [CARRY_OUT]), group["id"])
    learn(client, "pavel")
    session = client.post("/api/sessions", json={"kind": "spelling"}, headers=as_("pavel")).json()
    card = session["exercises"][0]
    assert card["prompt"]["translation"] == "проводить, выполнять"
    assert card["slots"] == 8
    assert card["separators"] == [{"after": 5, "char": " "}]
    assert " " not in card["tiles"] and "carry out" not in str(card)
    hint = client.post(
        f"/api/sessions/{session['id']}/exercises/{card['id']}/hint",
        json={"position": 5},
        headers=as_("pavel"),
    ).json()
    assert hint == {"position": 5, "letter": "o"}  # among the letters: c-a-r-r-y, then o
    result = client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": card["id"], "response": {"kind": "spelling", "answer": "carry out"}},
        headers=as_("pavel"),
    ).json()
    assert result["correct"] is True


def test_the_board_shows_given_decks_and_the_owner_sees_everyones_count(
    client: TestClient,
) -> None:
    group = class_group(client)
    give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel")

    mine = client.get(f"/api/groups/{group['id']}/board", headers=as_("pavel")).json()
    (given,) = mine["assignments"]
    assert (given["title"], given["author"], given["is_mine"]) == ("Unit 4", "Ольга", False)
    assert (given["word_count"], given["mine"], given["members"]) == (3, 3, None)
    # The whole group on the deck, for every member: 3 of 9 words met, one of three done.
    assert given["group"] == {"met": 3, "total": 9, "finished": 1, "learners": 3}
    owner = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    (given,) = owner["assignments"]
    assert given["mine"] == 0 and given["is_mine"]  # she learns it too, and hasn't started
    nicknames = {row["member_id"]: row["nickname"] for row in owner["rows"]}
    # Met today, so nothing is remembered well yet (that takes weeks of reviews).
    assert {nicknames[m["member_id"]]: (m["met"], m["known"]) for m in given["members"]} == {
        "Ольга": (0, 0),
        "Павел": (3, 0),
        "Иван": (0, 0),
    }
    # Places are the board's own rule: Pavel answered this week, so he alone has one.
    first = owner["rows"][0]
    assert (nicknames[first["member_id"]], first["rank"]) == ("Павел", 1)


def test_progress_toward_the_course_goal_counts_course_words_only(client: TestClient) -> None:
    group = class_group(client)
    give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel")
    words = client.get("/api/progress", headers=as_("pavel")).json()["words"]
    assert words["introduced"] == 3  # money, house and water; not setback or carry out


def test_corrections_reach_learners_and_taking_back_stops_new_words(
    client: TestClient, db: Session
) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT]), group["id"])
    setback_id, carry_id = (w["word"]["id"] for w in deck["words"])
    learn(client, "pavel")

    fixed = client.put(
        f"/api/decks/{deck['id']}/words/{setback_id}",
        json=SETBACK | {"translation": "неудача, препятствие"},
        headers=as_("olga"),
    )
    assert fixed.status_code == 200
    browsed = client.get(f"/api/decks/{deck['id']}/words", headers=as_("pavel")).json()
    assert browsed[0]["word"]["translation"] == "неудача, препятствие"
    assert client.get(f"/api/decks/{deck['id']}/words", headers=as_("stranger")).status_code == 404

    # Out of a published deck: learners who met it keep it.
    after = client.delete(f"/api/decks/{deck['id']}/words/{carry_id}", headers=as_("olga")).json()
    assert [w["word"]["headword"] for w in after["words"]] == ["setback"]
    kept = db.scalars(select(UserWordProgress.word_id).where(UserWordProgress.word_id == carry_id))
    assert list(kept) == [carry_id]

    taken = client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("olga"))
    assert taken.status_code == 204
    # Taken back: gone for everyone, whoever gave it included.
    for user in ("ivan", "olga"):
        listed = client.get("/api/decks", headers=as_(user)).json()
        assert all(d["kind"] == "course" for d in listed), user
    assert new_words(client, "ivan") == ["house", "water", "friend", "buy", "cheap"]
    again = client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("olga"))
    assert again.status_code == 404
    member = client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("pavel"))
    assert member.status_code == 403
