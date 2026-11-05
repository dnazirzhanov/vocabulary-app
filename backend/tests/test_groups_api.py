"""Friend groups through the API: invites, privacy, membership changes and the weekly board."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import at, finish, spell_today

# Thursday 5 November 2026, 09:00 UTC; the group's week is Monday 2 – Sunday 8 November.
THURSDAY = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
NEW = {"kind": "study", "deck_id": "a1-a2"}


def as_(name: str, moment: datetime = THURSDAY, zone: str = "UTC") -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment, zone)


def create(client: TestClient, owner: str = "olga", name: str = "7Б английский") -> dict[str, Any]:
    response = client.post(
        "/api/groups", json={"name": name, "nickname": "Смелый Ёж"}, headers=as_(owner)
    )
    assert response.status_code == 201
    group: dict[str, Any] = response.json()
    return group


def join(client: TestClient, user: str, code: str, nickname: str) -> Any:
    return client.post(f"/api/groups/join/{code}", json={"nickname": nickname}, headers=as_(user))


def test_create_preview_and_join_by_code(client: TestClient) -> None:
    group = create(client)
    assert group["role"] == "owner" and group["member_count"] == 1
    code = group["invite_code"]

    preview = client.get(f"/api/groups/join/{code.lower()}", headers=as_("pavel")).json()
    assert preview == {"name": "7Б английский", "member_count": 1, "already_member": False}

    joined = join(client, "pavel", code, "Весёлый Кот")
    assert joined.status_code == 200
    assert (joined.json()["role"], joined.json()["member_count"]) == ("member", 2)
    # A second tap on the invite changes nothing.
    assert join(client, "pavel", code, "Другое Имя").json()["nickname"] == "Весёлый Кот"
    assert [g["name"] for g in client.get("/api/groups", headers=as_("pavel")).json()] == [
        "7Б английский"
    ]


def test_nicknames_are_unique_within_a_group(client: TestClient) -> None:
    code = create(client)["invite_code"]
    taken = join(client, "pavel", code, "смелый ёж")  # case does not make a new name
    assert taken.status_code == 409
    assert taken.json()["error"]["code"] == "nickname_taken"
    assert join(client, "pavel", code, "ivan@mail.ru").status_code == 422


def test_unknown_codes_and_guessing_are_limited(client: TestClient) -> None:
    assert client.get("/api/groups/join/ZZZZZZZZ", headers=as_("pavel")).status_code == 404
    statuses = [
        client.get("/api/groups/join/ZZZZZZZZ", headers=as_("pavel")).status_code for _ in range(12)
    ]
    assert statuses[-1] == 429


def test_a_board_is_only_for_members_and_shows_no_contact_details(client: TestClient) -> None:
    group = create(client)
    assert (
        client.get(f"/api/groups/{group['id']}/board", headers=as_("stranger")).status_code == 404
    )
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    row = board["rows"][0]
    assert set(row) == {
        "member_id",
        "nickname",
        "role",
        "is_me",
        "learned",
        "days",
        "cards",
        "rank",
        "promised_days",
        "week",
        "studied_today",
        "week_states",
        "month_misses",
        "promise_today",
        "promise_weekdays",
        "paused",
        "known",
        "learning",
        "decks",
    }


def board_of(client: TestClient, group_id: str, period: str = "week") -> dict[str, Any]:
    board: dict[str, Any] = client.get(
        f"/api/groups/{group_id}/board", params={"period": period}, headers=as_("olga")
    ).json()
    return board


def test_the_board_ranks_by_words_learned_over_a_week_a_month_or_all_time(
    client: TestClient,
) -> None:
    group = create(client)
    code = group["invite_code"]
    join(client, "pavel", code, "Весёлый Кот")
    join(client, "rest", code, "Тихий Лис")
    client.patch("/api/me", json={"daily_target_words": 3}, headers=as_("olga"))
    client.put("/api/me/promise", json={"weekdays": [0, 1, 2]}, headers=as_("olga"))

    # Olga: a lesson on each of three days, new words only. Pavel: one lesson back in October,
    # then four in one day this week, the first recalling October's five words.
    monday = THURSDAY - timedelta(days=3)
    for n in range(3):
        moment = monday + timedelta(days=n)
        session = client.post("/api/sessions", json=NEW, headers=as_("olga", moment)).json()
        play_as(client, "olga", session, moment)
    october = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
    session = client.post("/api/sessions", json=NEW, headers=as_("pavel", october)).json()
    play_as(client, "pavel", session, october)
    for n in range(4):
        moment = THURSDAY - timedelta(hours=4) + timedelta(minutes=10 * n)
        session = client.post("/api/sessions", json=NEW, headers=as_("pavel", moment)).json()
        play_as(client, "pavel", session, moment)

    board = board_of(client, group["id"])
    assert (board["period"], board["period_start"], board["period_end"]) == (
        "week",
        "2026-11-02",
        "2026-11-08",
    )
    rows = {row["nickname"]: row for row in board["rows"]}
    olga, pavel, rest = rows["Смелый Ёж"], rows["Весёлый Кот"], rows["Тихий Лис"]
    # Words learned decide the place: Pavel's five recalled words beat Olga's three days.
    assert (pavel["learned"], pavel["days"], pavel["rank"]) == (5, 1, 1)
    assert (olga["learned"], olga["days"], olga["rank"]) == (3, 3, 2)
    assert olga["week"] == [True, True, True, False, False, False, False]
    assert olga["is_me"]
    assert (pavel["studied_today"], olga["studied_today"]) == (True, False)
    assert rest["rank"] is None
    # The report lists me first and then the others alphabetically, never by place.
    assert [row["nickname"] for row in board["rows"]] == ["Смелый Ёж", "Весёлый Кот", "Тихий Лис"]
    assert board["totals"] == {
        "days": 4,
        "learned": olga["learned"] + pavel["learned"],
        "cards": olga["cards"] + pavel["cards"],
    }

    # This month leaves October out; all time counts it.
    month = {row["nickname"]: row for row in board_of(client, group["id"], "month")["rows"]}
    ever = {row["nickname"]: row for row in board_of(client, group["id"], "all")["rows"]}
    assert (month["Весёлый Кот"]["days"], ever["Весёлый Кот"]["days"]) == (1, 2)
    assert ever["Весёлый Кот"]["cards"] > month["Весёлый Кот"]["cards"]
    assert board_of(client, group["id"], "all")["period_start"] is None


def test_the_list_of_groups_shows_each_group_s_pulse(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    session = client.post("/api/sessions", json=NEW, headers=as_("pavel")).json()
    play_as(client, "pavel", session, THURSDAY)
    (summary,) = client.get("/api/groups", headers=as_("olga")).json()
    # By the promise (Пн–Сб by default): both are promised today, Pavel has done it, Olga not yet.
    assert (summary["today_promised"], summary["today_done"], summary["my_today"]) == (
        2,
        1,
        "pending",
    )
    assert summary["members"] == [  # me first, then alphabetical
        {"nickname": "Смелый Ёж", "is_me": True, "studied_today": False},
        {"nickname": "Весёлый Кот", "is_me": False, "studied_today": True},
    ]


def play_as(
    client: TestClient, user: str, session: dict[str, Any], moment: datetime, zone: str = "UTC"
) -> None:
    """Rates every card «Хорошо», extra showings included, then spells today's words right."""
    finish(client, session, as_(user, moment, zone))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(user, moment, zone))
    spell_today(client, as_(user, moment, zone))


def test_the_days_of_the_report_are_the_groups(client: TestClient) -> None:
    # A group in Bishkek (UTC+6): 23:30 UTC on Sunday 1 November is already Monday 2 November there.
    group = client.post(
        "/api/groups",
        json={"name": "Бишкек", "nickname": "Ольга"},
        headers=as_("olga", zone="Asia/Bishkek"),
    ).json()
    join(client, "aibek", group["invite_code"], "Ранний Орёл")
    late_sunday = datetime(2026, 11, 1, 23, 30, tzinfo=UTC)
    client.patch("/api/me", json={"daily_target_words": 3}, headers=as_("aibek", late_sunday))
    session = client.post(
        "/api/sessions", json=NEW, headers=as_("aibek", late_sunday, "Asia/Bishkek")
    ).json()
    play_as(client, "aibek", session, late_sunday, "Asia/Bishkek")

    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    aibek = next(row for row in board["rows"] if row["nickname"] == "Ранний Орёл")
    assert aibek["week"][0] is True  # Monday, in the group's day
    assert aibek["days"] == 1


def test_owners_can_remove_members_and_ownership_passes_on(client: TestClient) -> None:
    group = create(client)
    code, group_id = group["invite_code"], group["id"]
    join(client, "pavel", code, "Весёлый Кот")
    join(client, "rest", code, "Тихий Лис")
    board = client.get(f"/api/groups/{group_id}/board", headers=as_("olga")).json()
    rest_id = next(r["member_id"] for r in board["rows"] if r["nickname"] == "Тихий Лис")

    not_owner = client.delete(f"/api/groups/{group_id}/members/{rest_id}", headers=as_("pavel"))
    assert not_owner.status_code == 403
    removed = client.delete(f"/api/groups/{group_id}/members/{rest_id}", headers=as_("olga"))
    assert removed.status_code == 204

    assert (
        client.delete(f"/api/groups/{group_id}/members/me", headers=as_("olga")).status_code == 204
    )
    groups = client.get("/api/groups", headers=as_("pavel")).json()
    assert (groups[0]["role"], groups[0]["member_count"]) == ("owner", 1)
    client.delete(f"/api/groups/{group_id}/members/me", headers=as_("pavel"))
    assert client.get(f"/api/groups/join/{code}", headers=as_("pavel")).status_code == 404


def member_id(client: TestClient, group_id: str, nickname: str, viewer: str = "olga") -> str:
    board = client.get(f"/api/groups/{group_id}/board", headers=as_(viewer)).json()
    return str(next(row["member_id"] for row in board["rows"] if row["nickname"] == nickname))


def code_of(response_json: dict[str, Any]) -> str:
    return str(response_json["error"]["code"])


# --- rights (ADR 0040) ---------------------------------------------------------------------


def test_each_role_is_told_what_it_may_do(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    (mine,) = client.get("/api/groups", headers=as_("olga")).json()
    assert group["can"] == mine["can"]
    assert set(mine["can"]) == {
        "rename",
        "give_decks",
        "see_standings",
        "reset_invite",
        "remove_member",
        "transfer_ownership",
        "manage_tests",
        "delete_group",
    }
    (theirs,) = client.get("/api/groups", headers=as_("pavel")).json()
    assert theirs["can"] == []


def test_the_owner_renames_the_group_and_everyone_sees_it(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    renamed = client.patch(
        f"/api/groups/{group['id']}", json={"name": "  8А   английский "}, headers=as_("olga")
    )
    assert (renamed.status_code, renamed.json()["name"]) == (200, "8А английский")
    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("pavel")).json()
    assert board["group"]["name"] == "8А английский"
    assert client.get("/api/groups", headers=as_("pavel")).json()[0]["name"] == "8А английский"


def test_only_the_owner_renames_and_the_name_follows_the_rules(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    path = f"/api/groups/{group['id']}"
    member = client.patch(path, json={"name": "Мой класс"}, headers=as_("pavel"))
    assert (member.status_code, code_of(member.json())) == (403, "not_allowed")
    stranger = client.patch(path, json={"name": "Мой класс"}, headers=as_("stranger"))
    assert stranger.status_code == 404
    for bad in ("x", "https://spam.example", "a@b.c", "<b>класс</b>"):
        refused = client.patch(path, json={"name": bad}, headers=as_("olga"))
        assert refused.status_code == 422, bad
    assert client.patch(path, json={"name": "x" * 41}, headers=as_("olga")).status_code == 422
    assert client.get(path + "/board", headers=as_("olga")).json()["group"]["name"] == (
        "7Б английский"
    )


def test_a_new_invite_link_stops_the_old_one(client: TestClient) -> None:
    group = create(client)
    old = group["invite_code"]
    join(client, "pavel", old, "Весёлый Кот")
    path = f"/api/groups/{group['id']}/invite"
    assert client.post(path, headers=as_("pavel")).status_code == 403
    fresh = client.post(path, headers=as_("olga")).json()
    assert fresh["invite_code"] != old and len(fresh["invite_code"]) == 8
    assert client.get(f"/api/groups/join/{old}", headers=as_("rest")).status_code == 404
    assert join(client, "rest", fresh["invite_code"], "Тихий Лис").status_code == 200
    # Nobody already in the group is thrown out by it.
    assert client.get(f"/api/groups/{group['id']}/board", headers=as_("pavel")).status_code == 200


def test_the_owner_hands_the_group_over_and_becomes_a_member(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    join(client, "rest", group["invite_code"], "Тихий Лис")
    path = f"/api/groups/{group['id']}/owner"
    pavel = member_id(client, group["id"], "Весёлый Кот")
    assert client.put(path, json={"member_id": pavel}, headers=as_("rest")).status_code == 403
    mine = member_id(client, group["id"], "Смелый Ёж")
    to_self = client.put(path, json={"member_id": mine}, headers=as_("olga"))
    assert (to_self.status_code, code_of(to_self.json())) == (409, "already_owner")
    nobody = client.put(path, json={"member_id": str(group["id"])}, headers=as_("olga"))
    assert nobody.status_code == 404

    handed = client.put(path, json={"member_id": pavel}, headers=as_("olga"))
    assert (handed.status_code, handed.json()["role"], handed.json()["can"]) == (200, "member", [])
    (theirs,) = client.get("/api/groups", headers=as_("pavel")).json()
    assert theirs["role"] == "owner" and "delete_group" in theirs["can"]
    # The old owner no longer manages the group.
    assert (
        client.patch(f"/api/groups/{group['id']}", json={"name": "Назад"}, headers=as_("olga"))
    ).status_code == 403


def test_the_owner_deletes_the_group_and_nobody_else_can(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    path = f"/api/groups/{group['id']}"
    assert client.delete(path, headers=as_("pavel")).status_code == 403
    assert client.delete(path, headers=as_("stranger")).status_code == 404
    assert client.delete(path, headers=as_("olga")).status_code == 204
    for user in ("olga", "pavel"):
        assert client.get("/api/groups", headers=as_(user)).json() == []
        assert client.get(path + "/board", headers=as_(user)).status_code == 404
    assert (
        client.get(f"/api/groups/join/{group['invite_code']}", headers=as_("rest")).status_code
        == 404
    )


def test_a_member_leaves_and_the_group_carries_on(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    leave = client.delete(f"/api/groups/{group['id']}/members/me", headers=as_("pavel"))
    assert leave.status_code == 204
    assert client.get("/api/groups", headers=as_("pavel")).json() == []
    (kept,) = client.get("/api/groups", headers=as_("olga")).json()
    assert (kept["role"], kept["member_count"]) == ("owner", 1)
    # They can come back by the same link, under any free name.
    assert join(client, "pavel", group["invite_code"], "Весёлый Кот").status_code == 200


def test_an_owner_who_leaves_names_who_takes_over(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    join(client, "rest", group["invite_code"], "Тихий Лис")
    path = f"/api/groups/{group['id']}/members/me"
    # Pavel joined first and would take over on his own; the owner chooses the other one.
    rest = member_id(client, group["id"], "Тихий Лис")
    assert client.delete(path, params={"successor": rest}, headers=as_("olga")).status_code == 204
    roles = {
        g["nickname"]: g["role"]
        for u in ("pavel", "rest")
        for g in client.get("/api/groups", headers=as_(u)).json()
    }
    assert roles == {"Весёлый Кот": "member", "Тихий Лис": "owner"}


def test_naming_a_successor_follows_the_rules(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    path = f"/api/groups/{group['id']}/members/me"
    mine = member_id(client, group["id"], "Смелый Ёж")
    # A member hands nothing over; an owner cannot name themselves or a stranger.
    assert client.delete(path, params={"successor": mine}, headers=as_("pavel")).status_code == 403
    self_named = client.delete(path, params={"successor": mine}, headers=as_("olga"))
    assert (self_named.status_code, code_of(self_named.json())) == (409, "already_owner")
    nobody = client.delete(path, params={"successor": str(group["id"])}, headers=as_("olga"))
    assert nobody.status_code == 404
    # Nothing changed: Olga still owns the group, with both members in it.
    (kept,) = client.get("/api/groups", headers=as_("olga")).json()
    assert (kept["role"], kept["member_count"]) == ("owner", 2)


def test_an_owner_cannot_remove_themselves(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    mine = member_id(client, group["id"], "Смелый Ёж")
    refused = client.delete(f"/api/groups/{group['id']}/members/{mine}", headers=as_("olga"))
    assert (refused.status_code, code_of(refused.json())) == (409, "cannot_remove_self")


def test_the_last_member_leaving_deletes_the_group(client: TestClient) -> None:
    group = create(client)
    leave = client.delete(f"/api/groups/{group['id']}/members/me", headers=as_("olga"))
    assert leave.status_code == 204
    assert (
        client.get(f"/api/groups/join/{group['invite_code']}", headers=as_("pavel")).status_code
        == 404
    )


def test_deleting_an_account_hands_over_its_groups(client: TestClient) -> None:
    group = create(client)
    join(client, "pavel", group["invite_code"], "Весёлый Кот")
    assert client.delete("/api/me", headers=as_("olga")).status_code == 204
    groups = client.get("/api/groups", headers=as_("pavel")).json()
    assert (groups[0]["role"], groups[0]["member_count"]) == ("owner", 1)


def test_a_learner_can_be_in_at_most_five_groups(client: TestClient) -> None:
    for n in range(5):
        create(client, name=f"Группа {n + 1}")
    too_many = client.post(
        "/api/groups", json={"name": "Шестая", "nickname": "Смелый Ёж"}, headers=as_("olga")
    )
    assert too_many.status_code == 409


def test_a_word_counts_as_learned_in_the_period_it_was_first_recalled(client: TestClient) -> None:
    group = create(client)
    october = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
    session = client.post("/api/sessions", json=NEW, headers=as_("olga", october)).json()
    play_as(client, "olga", session, october)  # met in October: not learned yet
    assert board_of(client, group["id"], "all")["rows"][0]["learned"] == 0
    # Reviewed and recalled this week: learned this week, this month and all time.
    session = client.post("/api/sessions", json=NEW, headers=as_("olga")).json()
    play_as(client, "olga", session, THURSDAY)
    week, ever = board_of(client, group["id"]), board_of(client, group["id"], "all")
    assert week["rows"][0]["learned"] == ever["rows"][0]["learned"] == 5
