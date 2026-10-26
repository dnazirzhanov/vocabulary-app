"""Group input rules and board ranking as pure functions (ADR 0011)."""

from datetime import date
from uuid import uuid4

import pytest

from app.core.errors import ApiError
from app.schemas.groups import BoardRow
from app.services.groups import (
    CODE_ALPHABET,
    clean_group_name,
    clean_nickname,
    new_invite_code,
    normalize_code,
    rank,
    week_of,
)


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


def row(nickname: str, days: int, points: int) -> BoardRow:
    return BoardRow(
        member_id=uuid4(),
        nickname=nickname,
        role="member",
        is_me=False,
        rank=None,
        days_practised=days,
        week=[False] * 7,
        points=points,
        streak_days=0,
    )


def test_showing_up_beats_speed_and_ties_share_a_place() -> None:
    ranked = rank(
        [
            row("Fast", 2, 900),  # 100 words a day, twice
            row("Steady", 5, 150),  # 3 words a day, five days
            row("Also steady", 5, 150),
            row("Resting", 0, 0),
            row("Busy", 4, 200),
        ]
    )
    assert [(r.nickname, r.rank) for r in ranked] == [
        ("Also steady", 1),
        ("Steady", 1),
        ("Busy", 3),
        ("Fast", 4),
        ("Resting", None),
    ]
