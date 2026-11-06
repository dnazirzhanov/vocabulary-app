"""New words a day per deck, extra words for one day, and a teacher's deadline (ADR 0028)."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.services.decks import standing
from app.services.pace import deadline_share, plan_day
from tests.support import at, cards, finish

THURSDAY = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
FRIDAY = THURSDAY + timedelta(days=1)
WORDS = [
    "quill",
    "anvil",
    "lantern",
    "harbor",
    "compass",
    "saddle",
    "barrel",
    "chisel",
    "kettle",
    "ladder",
    "funnel",
    "pebble",
]


def as_(name: str, moment: datetime = THURSDAY) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def a_deck(client: TestClient, owner: str, count: int = len(WORDS)) -> dict[str, Any]:
    deck: dict[str, Any] = client.post(
        "/api/decks", json={"title": "Морское дело"}, headers=as_(owner)
    ).json()
    for word in WORDS[:count]:
        response = client.post(
            f"/api/decks/{deck['id']}/words",
            json={"headword": word, "pos": "noun", "translation": "слово", "example": "An x."},
            headers=as_(owner),
        )
        assert response.status_code == 201, response.text
    return deck


def pace(client: TestClient, user: str, deck_id: str, moment: datetime = THURSDAY) -> Any:
    return client.get("/api/me/pace", params={"deck_id": deck_id}, headers=as_(user, moment)).json()


def lesson(client: TestClient, user: str, deck_id: str, moment: datetime = THURSDAY) -> list[str]:
    """A whole lesson; returns its new words."""
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck_id}, headers=as_(user, moment)
    ).json()
    new = [card["word"]["headword"] for card in cards(session) if card["new"]]
    finish(client, session, as_(user, moment))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(user, moment))
    return new


# --- the rules -------------------------------------------------------------------------------


def test_a_deadline_spreads_the_words_and_leaves_its_own_day_for_review() -> None:
    thursday = date(2026, 11, 5)
    saturday = thursday + timedelta(days=2)
    assert deadline_share(20, thursday, saturday) == 10  # Thursday and Friday, 10 each
    assert deadline_share(21, thursday, saturday) == 11
    assert deadline_share(20, thursday, thursday + timedelta(days=1)) == 20  # one day left
    assert deadline_share(20, thursday, thursday) == 20  # the deadline is today
    assert deadline_share(20, thursday, thursday - timedelta(days=3)) == 20  # past: catch up
    assert deadline_share(0, thursday, saturday) == 0


def test_the_day_s_goal_is_the_pace_or_the_deadline_share_plus_extra_words() -> None:
    assert plan_day(5, None, 0, 0).effective_target == 5
    assert plan_day(5, None, 0, 0, deadline=date(2026, 11, 7), share=10).effective_target == 10
    assert plan_day(5, None, 0, 0, deadline=date(2026, 11, 7), share=3).effective_target == 5
    extra = plan_day(5, None, 5, 0, extra=4)
    assert (extra.effective_target, extra.remaining) == (9, 4)
    # Too many reviews hold new words back, except before a deadline.
    assert plan_day(5, None, 0, 500).blocked_by_reviews
    assert not plan_day(5, None, 0, 500, deadline=date(2026, 11, 7), share=4).blocked_by_reviews


def test_a_member_s_standing_against_a_deadline() -> None:
    thursday = date(2026, 11, 5)
    friday, saturday = thursday + timedelta(days=1), thursday + timedelta(days=2)

    def status(met: int, today: date, total: int = 12, due: date = saturday) -> tuple[str, int]:
        result = standing(met, total, thursday, due, today)
        return result.status, result.behind

    # Given Thursday, due Saturday: six words a day on Thursday and Friday.
    assert status(0, thursday) == ("not_started", 0)  # today is still theirs
    assert status(3, thursday) == ("on_track", 0)
    assert status(0, friday) == ("not_started", 6)
    assert status(4, friday) == ("behind", 2)
    assert status(6, friday) == ("on_track", 0)
    assert status(10, saturday) == ("behind", 2)  # the deadline: every word was due
    assert status(12, friday) == ("done", 0)
    # Due the day it was given: all of it at once.
    assert status(5, thursday, due=thursday) == ("behind", 7)


# --- through the API -------------------------------------------------------------------------


def test_each_deck_has_its_own_pace_and_another_deck_does_not_use_it_up(
    client: TestClient,
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5}, headers=as_("olga"))
    deck = a_deck(client, "olga")
    assert pace(client, "olga", deck["id"])["target"] == 5  # the course's until set
    changed = client.put(
        f"/api/decks/{deck['id']}/pace", json={"daily_new": 3}, headers=as_("olga")
    )
    assert (changed.status_code, changed.json()["target"], changed.json()["course"]) == (
        200,
        3,
        False,
    )
    assert len(lesson(client, "olga", deck["id"])) == 3
    # The course's five words are still all there today.
    course = pace(client, "olga", "a1-a2")
    assert (course["target"], course["remaining_today"], course["course"]) == (5, 5, True)
    assert len(lesson(client, "olga", "a1-a2")) == 5
    # A course level's pace is the whole course's.
    client.put("/api/decks/a1-a2/pace", json={"daily_new": 8}, headers=as_("olga"))
    assert client.get("/api/me", headers=as_("olga")).json()["daily_target_words"] == 8
    bad = client.put(f"/api/decks/{deck['id']}/pace", json={"daily_new": 0}, headers=as_("olga"))
    assert bad.status_code == 422


def test_extra_words_are_the_next_ones_and_last_only_for_today(client: TestClient) -> None:
    deck = a_deck(client, "olga")
    client.put(f"/api/decks/{deck['id']}/pace", json={"daily_new": 3}, headers=as_("olga"))
    first = lesson(client, "olga", deck["id"])
    assert pace(client, "olga", deck["id"])["remaining_today"] == 0
    more = client.post(
        f"/api/decks/{deck['id']}/pace/extra", json={"words": 4}, headers=as_("olga")
    ).json()
    assert (more["extra_today"], more["effective_target"], more["remaining_today"]) == (4, 7, 4)
    extra = lesson(client, "olga", deck["id"])
    assert extra == WORDS[3:7] and not set(extra) & set(first)
    # «Прогресс» shows today's goal in the deck, with the extra words.
    rows = client.get("/api/progress/decks", headers=as_("olga")).json()["decks"]
    row = next(row for row in rows if row["id"] == deck["id"])
    assert (row["new_today"], row["goal_today"], row["due_on"], row["pace"]) == (7, 7, None, 3)
    # Up to 100 at a time, whatever the deck holds; it gives what it has left.
    for words, status in ((100, 200), (101, 422)):
        response = client.post(
            f"/api/decks/{deck['id']}/pace/extra", json={"words": words}, headers=as_("olga")
        )
        assert response.status_code == status
    assert pace(client, "olga", deck["id"])["remaining_today"] == 100
    # Tomorrow: the plain pace again, from the next words on.
    friday = pace(client, "olga", deck["id"], FRIDAY)
    assert (friday["extra_today"], friday["effective_target"]) == (0, 3)
    assert [w for w in lesson(client, "olga", deck["id"], FRIDAY) if w in WORDS] == WORDS[7:10]


def test_a_teacher_s_deadline_gives_even_shares_and_re_spreads_what_is_left(
    client: TestClient,
) -> None:
    group = client.post(
        "/api/groups", json={"name": "7Б", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", json={"nickname": "Павел"}, headers=as_("pavel")
    )
    deck = a_deck(client, "olga")
    saturday = date(2026, 11, 7)
    past = client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": "2026-11-01"},
        headers=as_("olga"),
    )
    assert (past.status_code, past.json()["error"]["code"]) == (422, "due_in_past")
    given = client.post(
        f"/api/decks/{deck['id']}/publish",
        json={"group_id": group["id"], "due_on": saturday.isoformat()},
        headers=as_("olga"),
    ).json()
    assert given["groups"][0]["due_on"] == "2026-11-07"
    client.put(f"/api/decks/{deck['id']}/pace", json={"daily_new": 2}, headers=as_("pavel"))

    # Twelve words, two days before Saturday: six today, though Pavel's own pace is two.
    today = pace(client, "pavel", deck["id"])
    assert (today["deadline"], today["deadline_share"], today["effective_target"]) == (
        "2026-11-07",
        6,
        6,
    )
    assert len(lesson(client, "pavel", deck["id"])) == 6
    # Friday is the last day: the six left.
    assert pace(client, "pavel", deck["id"], FRIDAY)["deadline_share"] == 6
    # The library and the board show it too.
    library = client.get("/api/decks/library", headers=as_("pavel")).json()
    assert library["from_groups"][0]["due_on"] == "2026-11-07"
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("pavel")).json()
    given_deck = board["assignments"][0]
    assert given_deck["due_on"] == "2026-11-07"
    # Who keeps up is told to nobody (ADR 0054), not even the owner.
    assert given_deck["my_standing"] == {"status": "on_track", "behind": 0}
    on_friday = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga", FRIDAY)).json()[
        "assignments"
    ][0]
    assert "on_track" not in on_friday and "members" not in on_friday
    (summary,) = client.get("/api/groups", headers=as_("olga", FRIDAY)).json()
    assert "behind_for_class" not in summary

    # The teacher moves it to tomorrow: everything left, today.
    moved = client.patch(
        f"/api/groups/{group['id']}/decks/{deck['id']}",
        json={"due_on": "2026-11-06"},
        headers=as_("olga"),
    )
    assert moved.status_code == 200
    assert pace(client, "pavel", deck["id"])["remaining_today"] == 6
    # Only the group's owner sets it; removing it returns to Pavel's own pace.
    student = client.patch(
        f"/api/groups/{group['id']}/decks/{deck['id']}",
        json={"due_on": None},
        headers=as_("pavel"),
    )
    assert student.status_code == 403
    client.patch(
        f"/api/groups/{group['id']}/decks/{deck['id']}", json={"due_on": None}, headers=as_("olga")
    )
    plain = pace(client, "pavel", deck["id"])
    assert (plain["deadline"], plain["effective_target"], plain["remaining_today"]) == (None, 2, 0)


def test_starting_another_deck_sets_the_open_lesson_aside(client: TestClient) -> None:
    """ADR 0035: no «finish the other lesson first» — the new deck's lesson starts, the other
    one's answers stay, and it never counts as finished."""
    deck = a_deck(client, "olga")
    course = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/sessions/{course['id']}/attempts",
        json={
            "exercise_id": course["exercises"][0]["id"],
            "response": {"kind": "rating", "rating": 3},
        },
        headers=as_("olga"),
    )
    # The same deck again: the open lesson is resumed, as before.
    again = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_("olga")
    ).json()
    assert again["id"] == course["id"]
    # Another deck: its own lesson, and that one is now the open one.
    mine = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck["id"]}, headers=as_("olga")
    ).json()
    assert mine["id"] != course["id"] and mine["deck_id"] == deck["id"]
    active = client.get("/api/sessions/active", headers=as_("olga")).json()["session"]
    assert active["id"] == mine["id"]
    # The set-aside lesson isn't finished: no study day from it, and the course starts afresh.
    today = client.get("/api/progress", headers=as_("olga")).json()["today"]
    assert (today["active"], today["studied"]) == (True, False)
    fresh = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_("olga")
    ).json()
    assert fresh["id"] not in (course["id"], mine["id"])
