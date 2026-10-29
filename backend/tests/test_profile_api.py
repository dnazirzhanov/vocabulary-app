"""The profile window (ADR 0015): a week against one's own promise, and learning beyond it. Own
profile for everyone; group members can open each other's, and nobody else can."""

from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import Play, at
from tests.test_groups_api import NEW, THURSDAY, as_, create, join, play_as

HARD = {"kind": "hard", "deck_id": "a1-a2"}
KEYS = {
    "nickname",
    "is_me",
    "week_start",
    "week_end",
    "words_per_day",
    "promised_days",
    "plan_days",
    "week",
    "today_index",
    "planned_words",
    "streak_weeks",
    "words_total",
    "extra",
}


def lesson(client: TestClient, user: str, moment: Any = THURSDAY) -> None:
    session = client.post("/api/sessions", json=NEW, headers=as_(user, moment)).json()
    play_as(client, user, session, moment)


def test_my_profile_shows_the_plan_and_the_extra_apart(client: TestClient, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 5, "study_days_per_week": 4})
    play(NEW, THURSDAY)  # the plan of five words
    play(NEW, THURSDAY + timedelta(hours=1))  # five more: extra
    play(HARD, THURSDAY + timedelta(hours=2))  # practice: extra
    profile = client.get("/api/me/profile", headers=at(THURSDAY)).json()
    assert set(profile) == KEYS
    assert (profile["nickname"], profile["is_me"]) == (None, True)
    assert (profile["week_start"], profile["week_end"]) == ("2026-11-02", "2026-11-08")
    assert (profile["words_per_day"], profile["promised_days"]) == (5, 4)
    assert profile["week"] == [False, False, False, True, False, False, False]
    assert (profile["plan_days"], profile["today_index"]) == (1, 3)
    assert (profile["planned_words"], profile["words_total"]) == (5, 10)
    assert profile["extra"]["new_words"] == 5
    assert profile["extra"]["practice_answers"] >= 10


def test_a_member_s_profile_matches_their_row_on_the_board(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    lesson(client, "pavel")
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    row = next(r for r in board["rows"] if r["nickname"] == "Весёлый Кот")
    path = f"/api/groups/{group['id']}/members/{row['member_id']}/profile"
    profile = client.get(path, headers=as_("olga")).json()
    assert set(profile) == KEYS  # nickname and numbers; no user id, no e-mail
    assert (profile["nickname"], profile["is_me"]) == ("Весёлый Кот", False)
    assert (profile["plan_days"], profile["week"], profile["promised_days"]) == (
        row["plan_days"],
        row["week"],
        row["promised_days"],
    )
    own_row = next(r for r in board["rows"] if r["is_me"])
    own = f"/api/groups/{group['id']}/members/{own_row['member_id']}/profile"
    assert client.get(own, headers=as_("olga")).json()["is_me"] is True


def test_only_members_of_that_group_see_a_profile(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    other = create(client, owner="rest", name="Другая группа")
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    pavel = next(r for r in board["rows"] if r["nickname"] == "Весёлый Кот")["member_id"]
    path = f"/api/groups/{group['id']}/members/{pavel}/profile"

    stranger = client.get(path, headers=as_("stranger"))
    assert (stranger.status_code, stranger.json()["error"]["code"]) == (404, "group_not_found")
    # A member id from another group is no member here.
    other_board = client.get(f"/api/groups/{other['id']}/board", headers=as_("rest")).json()
    elsewhere = other_board["rows"][0]["member_id"]
    wrong = client.get(
        f"/api/groups/{group['id']}/members/{elsewhere}/profile", headers=as_("olga")
    )
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (404, "member_not_found")
    # Removed members are gone.
    client.delete(f"/api/groups/{group['id']}/members/{pavel}", headers=as_("olga"))
    gone = client.get(path, headers=as_("olga"))
    assert (gone.status_code, gone.json()["error"]["code"]) == (404, "member_not_found")
