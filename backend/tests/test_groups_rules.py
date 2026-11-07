"""Group input rules and board ranking as pure functions (ADR 0011)."""

from datetime import date
from uuid import uuid4

import pytest

from app.core.errors import ApiError
from app.schemas.groups import BoardRow
from app.services.groups import (
    CODE_ALPHABET,
    clean_group_name,
    new_invite_code,
    normalize_code,
    period_bounds,
    rank,
)
from app.services.names import clean_name
from app.services.study_days import week_of


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("Быстрый Барсук", "Быстрый Барсук"),
        ("  Ёжик   7 ", "Ёжик 7"),
        ("Max-2", "Max-2"),
        ("Анна К.", "Анна К."),
    ],
)
def test_names_are_tidied(raw: str, clean: str) -> None:
    assert clean_name(raw) == clean


@pytest.mark.parametrize(
    "raw",
    [
        "a",  # too short
        "x" * 21,
        "ivan@mail.ru",  # contact details: no "@", no dot inside a word
        "ivan.ru",
        "1.2",
        "+996 555 123",  # phone-like
        "0555123456",
        "1234",  # only a number
        "wwwfun",
        "httpkid",
        "<b>",
    ],
)
def test_names_cannot_carry_contacts_or_links(raw: str) -> None:
    with pytest.raises(ApiError):
        clean_name(raw)


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


def row(name: str, learned: int = 0, days: int = 0, cards: int = 0) -> BoardRow:
    return BoardRow(
        member_id=uuid4(),
        name=name,
        role="member",
        is_me=False,
        learned=learned,
        days=days,
        cards=cards,
        rank=None,
        promised_days=5,
        week=[False] * 7,
        studied_today=False,
        week_states=["off"] * 7,
        month_misses=0,
        promise_today="off",
        promise_weekdays=[0, 1, 2, 3, 4],
        paused=False,
        known=0,
        learning=0,
    )


def test_places_go_by_words_learned_then_days_and_equal_ones_share_a_place() -> None:
    rows = [
        row("Cards", learned=2, days=5, cards=900),  # many cards don't buy a place
        row("Learner", learned=30, days=2, cards=100),
        row("Steady", learned=12, days=5, cards=80),
        row("Also steady", learned=12, days=5, cards=60),
        row("Fewer days", learned=12, days=4, cards=40),
        row("Started", cards=4),  # answered, nothing learned yet: last with a place
        row("Resting"),
    ]
    assert [(r.name, r.rank) for r in rank(rows)] == [
        ("Learner", 1),
        ("Also steady", 2),
        ("Steady", 2),
        ("Fewer days", 4),
        ("Cards", 5),
        ("Started", 6),
        ("Resting", None),
    ]


def test_periods_are_this_week_this_month_and_all_time() -> None:
    thursday = date(2026, 11, 5)
    assert period_bounds("week", thursday) == (date(2026, 11, 2), date(2026, 11, 8))
    assert period_bounds("month", thursday) == (date(2026, 11, 1), date(2026, 11, 30))
    assert period_bounds("month", date(2026, 2, 10)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert period_bounds("all", thursday) == (None, thursday)
