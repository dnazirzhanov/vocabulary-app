"""Friend groups through the API: invites, privacy, membership changes and the weekly board."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.support import at, finish

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
        "rank",
        "plan_days",
        "promised_days",
        "week",
        "streak_weeks",
    }


def test_the_board_ranks_by_the_share_of_one_s_own_promise_kept(client: TestClient) -> None:
    group = create(client)
    code = group["invite_code"]
    join(client, "pavel", code, "Весёлый Кот")
    join(client, "rest", code, "Тихий Лис")
    client.patch(
        "/api/me", json={"daily_target_words": 3, "study_days_per_week": 3}, headers=as_("olga")
    )

    # Olga: her 3 words on the three days she promised. Pavel: 20 words in one day (his plan of
    # 5, then bonus lessons) against six days promised.
    monday = THURSDAY - timedelta(days=3)
    for n in range(3):
        moment = monday + timedelta(days=n)
        session = client.post("/api/sessions", json=NEW, headers=as_("olga", moment)).json()
        play_as(client, "olga", session, moment)
    for n in range(4):
        moment = THURSDAY - timedelta(hours=4) + timedelta(minutes=10 * n)
        session = client.post("/api/sessions", json=NEW, headers=as_("pavel", moment)).json()
        play_as(client, "pavel", session, moment)

    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    assert (board["week_start"], board["week_end"]) == ("2026-11-02", "2026-11-08")
    rows = {row["nickname"]: row for row in board["rows"]}
    olga, pavel, rest = rows["Смелый Ёж"], rows["Весёлый Кот"], rows["Тихий Лис"]
    assert (olga["rank"], olga["plan_days"], olga["promised_days"]) == (1, 3, 3)
    assert olga["week"] == [True, True, True, False, False, False, False]
    assert olga["is_me"] and olga["streak_weeks"] == 1  # this week's promise is kept
    # Volume does not help: one day of six is behind three of three.
    assert (pavel["rank"], pavel["plan_days"], pavel["promised_days"]) == (2, 1, 6)
    assert (rest["rank"], rest["plan_days"]) == (None, 0)
    assert [row["nickname"] for row in board["rows"]] == ["Смелый Ёж", "Весёлый Кот", "Тихий Лис"]
    # Co-operative goal: planned words only (Pavel's bonus words do not count), against
    # everyone's week of plans (3×3 + 5×6 + 5×6).
    assert board["goal"] == {"done": 3 * 3 + 5, "target": 69}


def play_as(client: TestClient, user: str, session: dict[str, Any], moment: datetime) -> None:
    """Rates every card «Хорошо» and builds every word right, extra showings included."""
    finish(client, session, as_(user, moment))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(user, moment))


def test_each_member_s_days_are_counted_in_their_own_time_zone(client: TestClient) -> None:
    group = create(client)
    join(client, "aibek", group["invite_code"], "Ранний Орёл")
    # 23:30 UTC on Sunday 1 November is already Monday 2 November in Bishkek (UTC+6).
    late_sunday = datetime(2026, 11, 1, 23, 30, tzinfo=UTC)
    client.patch("/api/me", json={"daily_target_words": 3}, headers=as_("aibek", late_sunday))
    client.get(
        "/api/me/pace", params={"deck_id": "a1-a2"}, headers=as_("aibek", zone="Asia/Bishkek")
    )
    # Every request from Aibek's browser carries his zone, starting a session too.
    session = client.post(
        "/api/sessions", json=NEW, headers=as_("aibek", late_sunday, "Asia/Bishkek")
    ).json()
    play_as(client, "aibek", session, late_sunday)

    board = client.get(f"/api/groups/{group['id']}/board", headers=as_("olga")).json()
    aibek = next(row for row in board["rows"] if row["nickname"] == "Ранний Орёл")
    assert aibek["week"][0] is True  # Monday, in Aibek's own zone
    assert aibek["plan_days"] == 1


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
