"""Teachers' decks through the API (ADR 0017): written by a group's owner, given to the group, met
by its members first within their own daily pace, never counted toward the course goal."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Deck, DeckAssignment, User, UserWordProgress, Word
from tests.support import at, cards, finish

THURSDAY = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
CONTINUE = {"kind": "study"}  # no deck: every level's reviews, then the current level's words

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


def lesson_of(deck: dict[str, Any] | None) -> dict[str, str]:
    return CONTINUE | {"deck_id": deck["id"]} if deck else CONTINUE


def new_words(client: TestClient, user: str, deck: dict[str, Any] | None = None) -> list[str]:
    """The new words of the user's next lesson of `deck`, in order (the lesson is left open)."""
    session = client.post("/api/sessions", json=lesson_of(deck), headers=as_(user)).json()
    return [card["word"]["headword"] for card in cards(session) if card["new"]]


def learn(client: TestClient, user: str, deck: dict[str, Any] | None = None) -> None:
    """One whole lesson of `deck` for `user`, every card «Хорошо»."""
    session = client.post("/api/sessions", json=lesson_of(deck), headers=as_(user)).json()
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


def test_a_given_deck_is_studied_by_opening_it(client: TestClient) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    assert deck["status"] == "published" and deck["groups"][0]["name"] == "7Б английский"
    # Giving it again changes nothing.
    assert give(client, deck, group["id"])["groups"] == deck["groups"]

    # Home lists the course's levels only (ADR 0020); the deck is in «Мои колоды».
    listed = client.get("/api/decks", headers=as_("pavel")).json()
    assert deck["id"] not in [d["id"] for d in listed]
    (theirs,) = client.get("/api/decks/library", headers=as_("pavel")).json()["from_groups"]
    assert (theirs["id"], theirs["author"], theirs["group_name"]) == (
        deck["id"],
        "Ольга",
        "7Б английский",
    )
    # Opened, it brings its own words, within the pace; the course lesson stays the course's.
    assert new_words(client, "pavel", deck) == ["setback", "carry out", "money"]
    assert new_words(client, "ivan") == ["house", "water", "friend", "buy", "cheap"]
    # Whoever gave it learns it the same way.
    assert new_words(client, "olga", deck) == ["setback", "carry out", "money"]


def test_a_decks_page_shows_my_progress_on_it(client: TestClient) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    stats = client.get(f"/api/decks/{deck['id']}/stats", headers=as_("pavel")).json()
    assert (stats["title"], stats["kind"], stats["author"], stats["group_name"]) == (
        "Unit 4",
        "user",
        "Ольга",
        "7Б английский",
    )
    assert (stats["word_count"], stats["introduced_count"], stats["new_today"]) == (3, 0, 3)
    assert not stats["is_mine"] and not stats["locked"]

    learn(client, "pavel", deck)
    stats = client.get(f"/api/decks/{deck['id']}/stats", headers=as_("pavel")).json()
    # All three met: nothing new left in it, though today's pace has room for two more.
    assert (stats["introduced_count"], stats["well_learned"], stats["new_today"]) == (3, 0, 0)
    # Spelling covers today's words, whichever deck they came from.
    assert (stats["spelling_today"]["ready"], stats["spelling_today"]["today_left"]) == (3, 3)
    assert client.get(f"/api/decks/{deck['id']}/stats", headers=as_("olga")).json()["is_mine"]
    stranger = client.get(f"/api/decks/{deck['id']}/stats", headers=as_("stranger"))
    assert stranger.status_code == 404

    # A later level is locked: nothing new there yet.
    levels = client.get("/api/decks", headers=as_("pavel")).json()
    later = client.get(f"/api/decks/{levels[1]['id']}/stats", headers=as_("pavel")).json()
    assert (later["kind"], later["locked"], later["new_today"]) == ("course", True, 0)


def test_a_phrase_is_spelled_with_its_gaps(client: TestClient) -> None:
    group = class_group(client)
    give(client, write_deck(client, group["id"], [CARRY_OUT]), group["id"])
    deck = client.get("/api/decks/library", headers=as_("pavel")).json()["from_groups"][0]
    learn(client, "pavel", deck)
    session = client.post("/api/sessions", json={"kind": "spelling"}, headers=as_("pavel")).json()
    card = session["exercises"][0]
    assert card["prompt"]["translation"] == "проводить, выполнять"
    assert card["slots"] == 8
    assert card["separators"] == [{"after": 5, "char": " "}]
    # The phrase comes only to be heard (ADR 0047).
    assert card.pop("pronunciation")["text"] == "carry out"
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
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel", deck)

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
    pavel = next(row for row in owner["rows"] if nicknames[row["member_id"]] == "Павел")
    assert pavel["rank"] == 1


def test_every_member_sees_how_many_words_each_friend_learned_from_the_deck(
    client: TestClient,
) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel", deck)  # Thursday: three words met, none recalled yet
    later = at(THURSDAY + timedelta(days=10))  # reviews fall due after a gap of days
    session = client.post(
        "/api/sessions", json=lesson_of(deck), headers={"X-Dev-User": "pavel"} | later
    ).json()
    finish(client, session, {"X-Dev-User": "pavel"} | later)  # ten days on: the three come back
    client.post(f"/api/sessions/{session['id']}/complete", headers={"X-Dev-User": "pavel"} | later)

    for viewer in ("ivan", "pavel"):  # a member, not only the owner, sees everyone's
        board = client.get(
            f"/api/groups/{group['id']}/board",
            headers={"X-Dev-User": viewer} | later,
        ).json()
        decks = {row["nickname"]: row["decks"] for row in board["rows"]}
        assert decks["Павел"] == [
            {"deck_id": deck["id"], "title": "Unit 4", "word_count": 3, "met": 3, "learned": 3}
        ]
        assert [(d["met"], d["learned"]) for d in decks["Иван"]] == [(0, 0)]
        assert [(d["met"], d["learned"]) for d in decks["Ольга"]] == [(0, 0)]


def test_a_group_with_no_deck_has_no_deck_lines(client: TestClient) -> None:
    group = class_group(client)
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    assert all(row["decks"] == [] for row in board["rows"])


def test_deleting_a_group_keeps_its_decks_and_what_was_learned(
    client: TestClient, db: Session
) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel", deck)
    assert client.delete(f"/api/groups/{group['id']}", headers=as_("olga")).status_code == 204

    assert db.scalar(select(func.count()).select_from(DeckAssignment)) == 0
    assert db.get(Deck, deck["id"]) is not None  # still its author's deck
    pavels = (
        select(func.count())
        .select_from(UserWordProgress)
        .join(User, User.id == UserWordProgress.user_id)
    )
    assert db.scalar(pavels.where(User.auth_subject == "dev|pavel")) == 3
    # The author can give it to another group.
    other = client.post(
        "/api/groups", json={"name": "8А", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    assert give(client, deck, other["id"])["status"] == "published"


def test_progress_toward_the_course_goal_counts_course_words_only(client: TestClient) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT, MONEY]), group["id"])
    learn(client, "pavel", deck)
    words = client.get("/api/progress", headers=as_("pavel")).json()["words"]
    assert words["introduced"] == 1  # money, a course word; not setback or carry out


def test_corrections_reach_learners_and_taking_back_stops_new_words(
    client: TestClient, db: Session
) -> None:
    group = class_group(client)
    deck = give(client, write_deck(client, group["id"], [SETBACK, CARRY_OUT]), group["id"])
    setback_id, carry_id = (w["word"]["id"] for w in deck["words"])
    learn(client, "pavel", deck)

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
    # Taken back: gone from «Из моих групп» for everyone; the author keeps it as hers.
    library = client.get("/api/decks/library", headers=as_("ivan")).json()
    assert library["from_groups"] == []
    assert client.get(f"/api/decks/{deck['id']}/stats", headers=as_("ivan")).status_code == 404
    hers = client.get("/api/decks/library", headers=as_("olga")).json()["mine"][0]
    assert (hers["id"], hers["groups"]) == (deck["id"], [])
    again = client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("olga"))
    assert again.status_code == 404
    member = client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("pavel"))
    assert member.status_code == 403


# --- when the author deletes their account (ADR 0043) ----------------------------------------


def _deck_exists(db: Session, deck_id: str) -> bool:
    db.expire_all()
    return db.get(Deck, deck_id) is not None


def test_an_authors_private_decks_go_with_their_account(client: TestClient, db: Session) -> None:
    private = write_deck(client, "", [SETBACK, CARRY_OUT])
    learn(client, "olga", private)
    assert client.delete("/api/me", headers=as_("olga")).status_code == 204
    assert not _deck_exists(db, private["id"])
    assert db.scalars(select(Word.id).where(Word.owner_deck_id == private["id"])).all() == []


def test_a_deck_given_to_a_group_stays_when_its_author_goes(
    client: TestClient, db: Session
) -> None:
    group = class_group(client)
    deck = write_deck(client, group["id"], [SETBACK, CARRY_OUT])
    give(client, deck, group["id"])
    learn(client, "pavel", deck)
    known = db.scalars(select(UserWordProgress.word_id)).all()

    assert client.delete("/api/me", headers=as_("olga")).status_code == 204

    assert _deck_exists(db, deck["id"])
    assert db.scalars(select(UserWordProgress.word_id)).all() == known
    assert client.get(f"/api/decks/{deck['id']}/words", headers=as_("pavel")).status_code == 200


def test_a_deck_someone_learned_stays_even_after_its_group_is_gone(
    client: TestClient, db: Session
) -> None:
    """Olga's group is gone with her, and with it the assignment, but Pavel learned those words:
    deleting the deck would take his progress, or fail on it."""
    group = client.post(
        "/api/groups", json={"name": "7Б английский", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}",
        json={"nickname": "Павел"},
        headers=as_("pavel"),
    )
    deck = write_deck(client, group["id"], [SETBACK, CARRY_OUT])
    give(client, deck, group["id"])
    learn(client, "pavel", deck)
    assert (
        client.delete(f"/api/groups/{group['id']}/members/me", headers=as_("pavel")).status_code
        == 204
    )

    assert client.delete("/api/me", headers=as_("olga")).status_code == 204

    assert _deck_exists(db, deck["id"])
    assert len(db.scalars(select(UserWordProgress.word_id)).all()) == 2


def test_undoing_and_giving_again_restores_the_deadline(client: TestClient) -> None:
    """A real undo (ADR 0049): give, set a date, take back, give again, and nothing is lost."""
    group = class_group(client)
    deck = write_deck(client, group["id"], [SETBACK])
    give(client, deck, group["id"])
    due = (THURSDAY + timedelta(days=7)).date().isoformat()
    url = f"/api/groups/{group['id']}/decks/{deck['id']}"
    assert client.delete(url, headers=as_("olga")).status_code == 204
    set_date = client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": due},
        headers=as_("olga"),
    )
    assert set_date.json()["groups"][0]["due_on"] == due

    assert client.delete(url, headers=as_("olga")).status_code == 204
    again = give(client, deck, group["id"])
    assert again["groups"][0]["due_on"] == due


def test_giving_again_drops_a_deadline_that_has_passed(client: TestClient) -> None:
    group = class_group(client)
    deck = write_deck(client, group["id"], [SETBACK])
    due = (THURSDAY + timedelta(days=2)).date().isoformat()
    client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": due},
        headers=as_("olga"),
    )
    client.delete(f"/api/groups/{group['id']}/decks/{deck['id']}", headers=as_("olga"))
    later = {"X-Dev-User": "olga"} | at(THURSDAY + timedelta(days=3))
    again = client.post(
        f"/api/decks/{deck['id']}/publish", json={"group_id": group["id"]}, headers=later
    ).json()
    assert again["groups"][0]["due_on"] is None


def test_a_group_owner_who_did_not_write_the_deck_can_remove_it(client: TestClient) -> None:
    group = class_group(client)
    deck = write_deck(client, group["id"], [SETBACK])
    give(client, deck, group["id"])
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("pavel")).json()
    pavel = next(row["member_id"] for row in board["rows"] if row["is_me"])
    handed = client.put(
        f"/api/groups/{group['id']}/owner", json={"member_id": pavel}, headers=as_("olga")
    )
    assert handed.status_code == 200
    url = f"/api/groups/{group['id']}/decks/{deck['id']}"
    assert client.delete(url, headers=as_("olga")).status_code == 403  # no longer the owner
    assert client.delete(url, headers=as_("pavel")).status_code == 204
