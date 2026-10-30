"""Group input rules and board ranking as pure functions (ADR 0011)."""

from datetime import date
from uuid import uuid4

import pytest

from app.core.errors import ApiError
from app.schemas.groups import BoardRow, RanksOut
from app.services.groups import (
    CODE_ALPHABET,
    clean_group_name,
    clean_nickname,
    new_invite_code,
    normalize_code,
    period_bounds,
    rank,
)
from app.services.plan_days import week_of


@pytest.mark.parametrize(
    ("raw", "clean"),
    [("Быстрый Барсук", "Быстрый Барсук"), ("  Ёжик   7 ", "Ёжик 7"), ("Max-2", "Max-2")],
)
def test_nicknames_are_tidied(raw: str, clean: str) -> None:
    assert clean_nickname(raw) == clean


@pytest.mark.parametrize(
    "raw",
    [
        "a",  # too short
        "x" * 21,
        "ivan@mail.ru",  # contact details: no "@" or "."
        "+996 555 123",  # phone-like
        "0555123456",
        "1234",  # only a number
        "wwwfun",
        "httpkid",
        "<b>",
    ],
)
def test_nicknames_cannot_carry_contacts_or_links(raw: str) -> None:
    with pytest.raises(ApiError):
        clean_nickname(raw)


def test_group_names() -> None:
    assert clean_group_name("  7Б   английский ") == "7Б английский"
    for bad in ("x", "join www.example.com", "me@school.kg"):
        with pytest.raises(ApiError):
            clean_group_name(bad)


def test_invite_codes_avoid_look_alike_characters() -> None:
    code = new_invite_code()
    assert len(code) == 8 and set(code) <= set(CODE_ALPHABET)
    assert not set("01IO") & set(CODE_ALPHABET)
    assert normalize_code(" abcd-efgh ") == "ABCDEFGH"


def test_the_week_runs_monday_to_sunday() -> None:
    days = week_of(date(2026, 11, 5))  # a Thursday
    assert (days[0], days[-1]) == (date(2026, 11, 2), date(2026, 11, 8))


def row(nickname: str, days: int, plan_days: int = 0, learned: int = 0, cards: int = 0) -> BoardRow:
    return BoardRow(
        member_id=uuid4(),
        nickname=nickname,
        role="member",
        is_me=False,
        days=days,
        plan_days=plan_days,
        learned=learned,
        cards=cards,
        ranks=RanksOut(steady=None, learned=None, cards=None),
        promised_days=5,
        week=[False] * 7,
        streak_weeks=0,
        studied_today=False,
    )


def test_steadiness_ranks_days_studied_then_plan_days_and_equal_ones_share_a_place() -> None:
    rows = [
        row("Fast", 1, 1, learned=40, cards=300),  # one huge day
        row("Steady", 5, 3, learned=10, cards=90),
        row("Also steady", 5, 3, learned=12, cards=80),
        row("Busy", 5, 5, learned=2, cards=60),
        row("Resting", 0),
    ]
    ranked = rank(rows)
    assert [(r.nickname, r.ranks.steady) for r in ranked] == [
        ("Busy", 1),
        ("Also steady", 2),
        ("Steady", 2),
        ("Fast", 4),
        ("Resting", None),
    ]
    by = {r.nickname: r.ranks for r in ranked}
    # The other rankings are kept on every row, so the board can switch without asking again.
    assert [by[name].learned for name in ("Fast", "Also steady", "Steady", "Busy")] == [1, 2, 3, 4]
    assert [by[name].cards for name in ("Fast", "Steady", "Also steady", "Busy")] == [1, 2, 3, 4]
    assert by["Resting"] == RanksOut(steady=None, learned=None, cards=None)


def test_periods_are_this_week_this_month_and_all_time() -> None:
    thursday = date(2026, 11, 5)
    assert period_bounds("week", thursday) == (date(2026, 11, 2), date(2026, 11, 8))
    assert period_bounds("month", thursday) == (date(2026, 11, 1), date(2026, 11, 30))
    assert period_bounds("month", date(2026, 2, 10)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert period_bounds("all", thursday) == (None, thursday)
