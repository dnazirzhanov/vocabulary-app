"""The promise (ADR 0039): chosen weekdays, each a clear yes or no; a change applies from
tomorrow; the report of who kept it; the monthly count of misses."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.services.promise import (
    Promise,
    day_state,
    mask_of,
    month_misses,
    preset,
    promise_of,
    today_state,
    week_states,
    week_streak,
    weekdays_of,
)
from app.services.study_days import StudyDay
from tests.support import at, finish

MONDAY = date(2026, 11, 2)
DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # Monday
WEEKDAYS = preset(5)  # Пн–Пт
WORKWEEK = Promise(5)


def done_on(*days: date) -> dict[date, StudyDay]:
    return {day: StudyDay(day=day, answers=5, finished=True) for day in days}


def on(offset: int) -> date:
    return MONDAY + timedelta(days=offset)


# --- the rules -------------------------------------------------------------------------------


def test_the_old_days_a_week_number_is_spread_over_the_week() -> None:
    assert weekdays_of(preset(3)) == [0, 2, 4]  # Пн Ср Пт, not Пн Вт Ср
    assert weekdays_of(preset(5)) == [0, 1, 2, 3, 4]
    assert weekdays_of(preset(7)) == [0, 1, 2, 3, 4, 5, 6]
    assert mask_of([0, 6]) == 65


def test_the_weekdays_in_force_depend_on_the_date_a_change_starts() -> None:
    # Пн–Сб until Tuesday 10 November, then Пн Ср Пт.
    promise = Promise(6, [(date(2020, 1, 1), preset(6)), (on(8), mask_of([0, 2, 4]))])
    assert promise.promised_on(on(5))  # Saturday 7 November, before the change
    assert not promise.promised_on(on(12))  # Saturday 14 November, after it
    assert promise.promised_on(on(1))  # Tuesday 3 November: promised then
    assert not promise.promised_on(on(8))  # Tuesday 10 November: no longer
    assert promise.promised_on(on(9)) and promise.promised_on(on(11))  # Wed and Fri still


def test_a_paused_day_is_not_promised() -> None:
    promise = Promise(5, pause=(on(2), on(4)))  # Wednesday to Friday
    # Tuesday, the pause's three days, then Monday after it.
    assert [promise.promised_on(on(n)) for n in (1, 2, 3, 4, 7)] == [
        True,
        False,
        False,
        False,
        True,
    ]


def test_each_day_of_the_report_is_done_missed_open_or_off() -> None:
    studied = done_on(on(0), on(2))  # Monday and Wednesday
    # Wednesday, still open: nothing finished yet today.
    states = week_states(WORKWEEK, done_on(on(0)), on(2))
    assert states == ["done", "missed", "today", "later", "later", "off", "off"]
    # Wednesday done: a ✓ today.
    assert week_states(WORKWEEK, studied, on(2))[2] == "done"
    # A day off that was studied anyway is simply done.
    assert day_state(WORKWEEK, done_on(on(5)), on(5), on(6)) == "done"


def test_nothing_can_be_missed_before_joining() -> None:
    joined_tuesday = on(1)
    states = week_states(WORKWEEK, {}, on(3), first_counted=joined_tuesday)
    assert states[0] == "off"  # Monday, before the first day that counts
    assert states[1] == "missed"


def test_today_by_the_promise() -> None:
    assert today_state(WORKWEEK, {}, on(1)) == "pending"
    assert today_state(WORKWEEK, done_on(on(1)), on(1)) == "done"
    assert today_state(WORKWEEK, {}, on(5)) == "off"  # a Saturday


def test_misses_are_promised_days_over_and_not_done_this_month() -> None:
    thursday_next_week = on(10)  # Nov 12
    # Promised and over: Nov 2–6 and 9–11, eight days; three done.
    assert month_misses(WORKWEEK, done_on(on(0), on(1), on(2)), thursday_next_week) == 5
    # Today is never counted: it isn't over.
    assert month_misses(WORKWEEK, {}, on(0)) == 0


def test_the_count_restarts_on_the_first_of_the_month() -> None:
    last_friday = date(2026, 11, 27)
    december_1, december_3 = date(2026, 12, 1), date(2026, 12, 3)
    assert month_misses(WORKWEEK, {}, last_friday) > 0
    assert month_misses(WORKWEEK, {}, december_1) == 0  # nothing yet this month
    assert month_misses(WORKWEEK, {}, december_3) == 2  # Dec 1 and 2, none from November


def test_misses_start_the_day_after_joining() -> None:
    # Today is Thursday 12 November; joined on Monday 9, so Tuesday 10 and Wednesday 11 count.
    assert month_misses(WORKWEEK, {}, on(10), first_counted=on(8)) == 2
    assert month_misses(WORKWEEK, {}, on(10)) == 8  # from the 1st: Nov 2–6 and 9–11


def test_the_streak_counts_weeks_with_every_promised_day_done() -> None:
    def weekdays_of_week(start: date) -> list[date]:
        return [start + timedelta(days=n) for n in range(5)]

    two_weeks = done_on(*weekdays_of_week(on(-14)), *weekdays_of_week(on(-7)))
    wednesday = on(2)
    this_week_so_far = {**two_weeks, **done_on(on(0), on(1), on(2))}
    assert week_streak(WORKWEEK, this_week_so_far, wednesday) == 2  # this week not complete
    complete = {**two_weeks, **done_on(*weekdays_of_week(on(0)))}
    assert week_streak(WORKWEEK, complete, wednesday) == 3
    broken = dict(complete)
    del broken[on(-7) + timedelta(days=1)]  # last week missed a Tuesday
    assert week_streak(WORKWEEK, broken, wednesday) == 1


def test_a_paused_week_neither_counts_nor_breaks_the_streak() -> None:
    paused_week = Promise(5, pause=(on(-7), on(-1)))
    earlier = done_on(*[on(-14) + timedelta(days=n) for n in range(5)])
    assert week_streak(paused_week, earlier, on(2)) == 1  # the week before the pause


# --- through the API -------------------------------------------------------------------------


def as_(name: str, moment: datetime = DAY0) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def promise_of_me(client: TestClient, name: str, moment: datetime = DAY0) -> dict[str, Any]:
    body: dict[str, Any] = client.get("/api/me", headers=as_(name, moment)).json()["promise"]
    return body


def lesson(client: TestClient, name: str, moment: datetime) -> None:
    session = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=as_(name, moment)
    ).json()
    finish(client, session, as_(name, moment))
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_(name, moment))


def test_the_first_promise_applies_at_once_and_later_ones_from_tomorrow(
    client: TestClient, db: Session
) -> None:
    client.put("/api/me/promise", json={"weekdays": [0, 2, 4]}, headers=as_("olga"))
    assert promise_of_me(client, "olga") == {"weekdays": [0, 2, 4], "pending": None, "pause": None}

    lesson(client, "olga", DAY0)  # something is finished: there is a past to protect
    changed = client.put("/api/me/promise", json={"weekdays": [1]}, headers=as_("olga")).json()
    assert changed["weekdays"] == [0, 2, 4]  # today still reads as promised
    assert changed["pending"] == {"effective_from": "2026-11-03", "weekdays": [1]}
    tuesday = DAY0 + timedelta(days=1)
    assert promise_of_me(client, "olga", tuesday)["weekdays"] == [1]
    # The past is not rewritten: Monday is still a Monday promise.
    user = db.scalars(select(User).where(User.auth_subject == "dev|olga")).one()
    assert promise_of(db, user).promised_on(MONDAY)


def test_the_old_days_a_week_setting_still_works(client: TestClient) -> None:
    client.patch("/api/me", json={"study_days_per_week": 3}, headers=as_("olga"))
    assert promise_of_me(client, "olga")["weekdays"] == [0, 2, 4]
    assert (
        client.put("/api/me/promise", json={"weekdays": []}, headers=as_("olga")).status_code == 422
    )
    assert (
        client.put("/api/me/promise", json={"weekdays": [0, 0]}, headers=as_("olga")).status_code
        == 422
    )
    assert (
        client.put("/api/me/promise", json={"weekdays": [7]}, headers=as_("olga")).status_code
        == 422
    )


def test_a_pause_starts_tomorrow_and_can_be_dropped(client: TestClient) -> None:
    paused = client.put(
        "/api/me/promise/pause", json={"until": "2026-11-06"}, headers=as_("olga")
    ).json()
    assert paused["pause"] == {"from_date": "2026-11-03", "until_date": "2026-11-06"}
    too_long = client.put(
        "/api/me/promise/pause", json={"until": "2026-12-20"}, headers=as_("olga")
    )
    assert (too_long.status_code, too_long.json()["error"]["code"]) == (422, "pause_range")
    today = client.put("/api/me/promise/pause", json={"until": "2026-11-02"}, headers=as_("olga"))
    assert today.status_code == 422  # it can't cover today
    assert client.delete("/api/me/promise/pause", headers=as_("olga")).json()["pause"] is None


def group_of_two(client: TestClient) -> dict[str, Any]:
    """Olga's group, joined by Pavel; both promise Пн–Пт."""
    for name in ("olga", "pavel"):
        client.put("/api/me/promise", json={"weekdays": [0, 1, 2, 3, 4]}, headers=as_(name))
    group: dict[str, Any] = client.post(
        "/api/groups", json={"name": "7Б", "nickname": "Ольга"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", json={"nickname": "Павел"}, headers=as_("pavel")
    )
    return group


def report(client: TestClient, group: dict[str, Any], moment: datetime) -> dict[str, Any]:
    body: dict[str, Any] = client.get(
        f"/api/groups/{group['id']}/board", headers=as_("olga", moment)
    ).json()
    return body


def test_the_report_says_who_kept_the_promise(client: TestClient) -> None:
    group = group_of_two(client)  # joined Monday: the first day that can be missed is Tuesday
    tuesday, wednesday, thursday = (DAY0 + timedelta(days=n) for n in (1, 2, 3))
    lesson(client, "olga", tuesday)
    lesson(client, "pavel", tuesday)
    lesson(client, "olga", wednesday)  # Pavel skips Wednesday
    midday = thursday.replace(hour=12)

    board = report(client, group, midday)
    olga, pavel = board["rows"]  # me first, then the others alphabetically
    assert (olga["nickname"], olga["is_me"]) == ("Ольга", True)
    assert olga["week_states"] == ["off", "done", "done", "today", "later", "off", "off"]
    assert pavel["week_states"] == ["off", "done", "missed", "today", "later", "off", "off"]
    assert (olga["month_misses"], pavel["month_misses"]) == (0, 1)
    assert olga["promise_weekdays"] == [0, 1, 2, 3, 4] and not olga["paused"]
    assert (olga["promise_today"], pavel["promise_today"]) == ("pending", "pending")
    assert (board["today_promised"], board["today_done"]) == (2, 0)

    lesson(client, "pavel", thursday)  # Pavel does today's promise
    board = report(client, group, midday + timedelta(hours=2))
    assert (board["today_promised"], board["today_done"]) == (2, 1)
    assert board["rows"][1]["promise_today"] == "done"
    # Words: Thursday's lesson recalled Tuesday's five (known) and met five new (learning).
    assert (board["rows"][1]["known"], board["rows"][1]["learning"]) == (5, 5)

    # The list of groups carries the same pulse.
    (summary,) = client.get("/api/groups", headers=as_("olga", midday)).json()
    assert (summary["today_promised"], summary["my_today"]) == (2, "pending")


def test_a_miss_is_counted_only_this_month(client: TestClient) -> None:
    group = group_of_two(client)
    lesson(client, "olga", DAY0 + timedelta(days=1))
    # Nobody studies again. On Thursday 3 December, December has two promised days behind it
    # (Tue 1, Wed 2); November's misses are not carried over.
    december = datetime(2026, 12, 3, 12, 0, tzinfo=UTC)
    olga, pavel = report(client, group, december)["rows"]
    assert (olga["month_misses"], pavel["month_misses"]) == (2, 2)


def test_a_paused_promise_cannot_be_missed(client: TestClient) -> None:
    group = group_of_two(client)
    client.put("/api/me/promise/pause", json={"until": "2026-11-06"}, headers=as_("pavel"))
    friday = DAY0 + timedelta(days=4, hours=3)
    pavel = report(client, group, friday)["rows"][1]
    # Pause covers Tue 3 – Fri 6 for Pavel; Monday, before joining, is off too.
    assert pavel["week_states"][:5] == ["off", "off", "off", "off", "off"]
    assert pavel["month_misses"] == 0
    assert pavel["promise_today"] == "off"
