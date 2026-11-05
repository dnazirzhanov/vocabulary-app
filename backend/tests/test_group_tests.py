"""A group's spelling tests (ADR 0046): the words, the shuffle, the clock, the results."""

import json
import random
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.db import get_sessionmaker
from app.models import (
    GroupMember,
    GroupTestAttempt,
    GroupTestQuestion,
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
    User,
    UserWordProgress,
    Word,
)
from app.services import group_tests
from app.services.cleanup import KEEP_ANSWERS, clean_up
from app.services.group_tests import GRACE, is_pass, shuffled
from app.services.spelling_ladder import HARD, KNOWN
from tests.support import at

NOW = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
HEADWORDS = [
    "setback",
    "carry out",
    "well-known",
    "bargain",
    "drought",
    "harvest",
    "lantern",
    "meadow",
    "orchard",
    "pebble",
    "quarrel",
    "ribbon",
]


def as_(name: str, moment: datetime = NOW) -> dict[str, str]:
    return {"X-Dev-User": name} | at(moment)


def word(headword: str) -> dict[str, str]:
    return {
        "headword": headword,
        "pos": "phrase" if " " in headword else "noun",
        # Never the word itself: tests look for it in what a student receives.
        "translation": f"перевод {headword[::-1]}",
        "example": f"An example with {headword}.",
    }


class Class:
    """Olga's group with Pavel and Ivan in it, and a deck given to it."""

    def __init__(self, client: TestClient, headwords: list[str] | None = None) -> None:
        self.client = client
        group = client.post(
            "/api/groups", json={"name": "7Б", "nickname": "Ольга"}, headers=as_("olga")
        ).json()
        self.group_id = group["id"]
        for user, nickname in (("pavel", "Павел"), ("ivan", "Иван")):
            joined = client.post(
                f"/api/groups/join/{group['invite_code']}",
                json={"nickname": nickname},
                headers=as_(user),
            )
            assert joined.status_code == 200
        deck = client.post("/api/decks", json={"title": "Unit 4"}, headers=as_("olga")).json()
        self.deck_id = deck["id"]
        for headword in HEADWORDS if headwords is None else headwords:
            added = client.post(
                f"/api/decks/{self.deck_id}/words", json=word(headword), headers=as_("olga")
            )
            assert added.status_code == 201, added.text
        given = client.post(
            f"/api/decks/{self.deck_id}/publish",
            json={"group_id": self.group_id},
            headers=as_("olga"),
        )
        assert given.status_code == 200, given.text

    @property
    def url(self) -> str:
        return f"/api/groups/{self.group_id}/tests/{self.deck_id}"

    def save(self, user: str = "olga", **settings: Any) -> Any:
        return self.client.put(self.url, json=settings, headers=as_(user))

    def open(self, is_open: bool = True, user: str = "olga") -> Any:
        return self.client.put(f"{self.url}/open", json={"open": is_open}, headers=as_(user))

    def ready(self, **settings: Any) -> None:
        assert self.save(**settings).status_code == 200
        assert self.open().status_code == 200

    def start(
        self, user: str, kind: str = "test", moment: datetime = NOW, only_weak: bool = False
    ) -> Any:
        return self.client.post(
            f"{self.url}/attempts",
            json={"kind": kind, "only_weak": only_weak},
            headers=as_(user, moment),
        )

    def detail(self, user: str = "olga", moment: datetime = NOW) -> dict[str, Any]:
        response = self.client.get(self.url, headers=as_(user, moment))
        assert response.status_code == 200, response.text
        result: dict[str, Any] = response.json()
        return result

    def answer(
        self, attempt: dict[str, Any], text: str, user: str, moment: datetime = NOW
    ) -> dict[str, Any]:
        response = self.client.post(
            f"/api/test-attempts/{attempt['id']}/answers",
            json={"question_id": attempt["question"]["id"], "answer": text},
            headers=as_(user, moment),
        )
        assert response.status_code == 200, response.text
        result: dict[str, Any] = response.json()
        return result

    def skip(
        self, attempt: dict[str, Any], user: str, moment: datetime = NOW, again: bool = False
    ) -> dict[str, Any]:
        response = self.client.post(
            f"/api/test-attempts/{attempt['id']}/skips",
            json={"question_id": attempt["question"]["id"], "again": again},
            headers=as_(user, moment),
        )
        assert response.status_code == 200, response.text
        result: dict[str, Any] = response.json()
        return result

    def take(self, user: str, wrong: int = 0, kind: str = "test") -> dict[str, Any]:
        """Answers every word, the first `wrong` of them wrongly."""
        attempt: dict[str, Any] = self.start(user, kind).json()
        count = 0
        while attempt["question"]:
            right = right_word(attempt["id"], attempt["question"]["id"])
            text = "zzz" if count < wrong else right
            attempt = self.answer(attempt, text, user)
            count += 1
        return attempt


def order_of(attempt_id: str) -> list[str]:
    with get_sessionmaker()() as db:
        return list(
            db.scalars(
                select(GroupTestQuestion.word_id)
                .where(GroupTestQuestion.attempt_id == attempt_id)
                .order_by(GroupTestQuestion.position)
            )
        )


def question_at(db: Session, attempt_id: str, key: str) -> GroupTestQuestion:
    question = db.scalar(
        select(GroupTestQuestion).where(
            GroupTestQuestion.attempt_id == attempt_id, GroupTestQuestion.key == key
        )
    )
    assert question is not None
    return question


def right_word(attempt_id: str, key: str) -> str:
    with get_sessionmaker()() as db:
        return question_at(db, attempt_id, key).headword


def _keys(attempt_id: str) -> list[str]:
    with get_sessionmaker()() as db:
        return list(
            db.scalars(
                select(GroupTestQuestion.key)
                .where(GroupTestQuestion.attempt_id == attempt_id)
                .order_by(GroupTestQuestion.position)
            )
        )


def names(rows: list[dict[str, Any]]) -> list[str]:
    return [row["nickname"] for row in rows]


# --- the rules ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("correct", "total", "percent", "passes"),
    [
        (8, 10, 80, True),
        (7, 10, 80, False),
        (4, 5, 80, True),
        (7, 9, 80, False),  # 77.8%
        (1, 1, 80, True),
        (0, 1, 80, False),
        (0, 0, 80, False),  # nothing to pass
        (6, 10, 60, True),
        (10, 10, 100, True),
        (9, 10, 100, False),
        (1, 3, 33, True),  # 33.33…% clears 33
        (33, 100, 34, False),
    ],
)
def test_pass_mark(correct: int, total: int, percent: int, passes: bool) -> None:
    assert is_pass(correct, total, percent) is passes


def test_the_shuffle_makes_every_order_equally_likely() -> None:
    """Chi-square over the 6 orders of 3 words: a biased shuffle (sorting by random values, or the
    classic swap-with-anything mistake) lands far above the 0.001 limit of 20.5 at 5 degrees."""
    rng = random.Random(46)
    draws = 60_000
    counts = Counter(tuple(shuffled("abc", rng)) for _ in range(draws))
    expected = draws / 6
    assert len(counts) == 6
    assert sum((seen - expected) ** 2 / expected for seen in counts.values()) < 20.5


def test_zero_and_one_item_shuffle_safely() -> None:
    rng = random.Random(1)
    assert shuffled([], rng) == []
    assert shuffled(["only"], rng) == ["only"]


# --- setting up -----------------------------------------------------------------------------


def test_only_the_owner_sets_up_and_opens(client: TestClient) -> None:
    room = Class(client)
    assert client.get(f"{room.url}/setup", headers=as_("pavel")).status_code == 403
    assert room.save("pavel").status_code == 403
    assert room.save().status_code == 200
    assert room.open(user="pavel").status_code == 403
    assert client.get(room.url, headers=as_("stranger")).status_code == 404
    assert client.get(f"{room.url}/setup", headers=as_("stranger")).status_code == 404


def test_defaults_are_every_word_ten_minutes_and_eighty_percent(client: TestClient) -> None:
    room = Class(client)
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    assert (setup["saved"], setup["pass_percent"], setup["minutes"]) == (False, 80, 10)
    assert len(setup["words"]) == len(HEADWORDS)
    assert room.save().status_code == 200
    settings = room.detail()["test"]
    assert settings == {
        "words": len(HEADWORDS),
        "minutes": 10,
        "pass_percent": 80,
        "is_open": False,
    }


def test_excluded_words_never_appear(client: TestClient) -> None:
    room = Class(client)
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    gone = [item["id"] for item in setup["words"] if item["headword"] in ("setback", "pebble")]
    room.ready(excluded_word_ids=gone)
    attempt = room.start("pavel").json()
    assert attempt["total"] == len(HEADWORDS) - 2
    assert not set(order_of(attempt["id"])) & set(gone)


def test_random_words_are_drawn_once_and_are_the_same_for_everyone(client: TestClient) -> None:
    room = Class(client)
    room.ready(question_count=5)
    pavel, ivan = room.start("pavel").json(), room.start("ivan").json()
    assert (pavel["total"], ivan["total"]) == (5, 5)
    assert set(order_of(pavel["id"])) == set(order_of(ivan["id"]))
    # Saving the same settings again, or only other time and pass mark, keeps the draw and results.
    words = set(order_of(pavel["id"]))
    assert room.save(question_count=5, minutes=20, pass_percent=50).status_code == 200
    assert client.get(f"/api/test-attempts/{pavel['id']}", headers=as_("pavel")).status_code == 200
    assert set(order_of(room.start("olga").json()["id"])) == words


@pytest.mark.parametrize(
    ("settings", "code"),
    [
        ({"question_count": 99}, "too_many_words"),
        ({"question_count": 0}, None),
        ({"pass_percent": 0}, None),
        ({"pass_percent": 101}, None),
        ({"minutes": 0}, None),
        ({"minutes": 181}, None),
    ],
)
def test_impossible_settings_are_refused(
    client: TestClient, settings: dict[str, Any], code: str | None
) -> None:
    room = Class(client)
    response = room.save(**settings)
    assert response.status_code == 422
    if code:
        assert response.json()["error"]["code"] == code


def test_a_test_needs_a_word_and_one_is_enough(client: TestClient) -> None:
    room = Class(client, ["setback"])
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    refused = room.save(excluded_word_ids=[setup["words"][0]["id"]])
    assert (refused.status_code, refused.json()["error"]["code"]) == (422, "no_words")

    room.ready()
    attempt = room.start("pavel").json()
    assert attempt["total"] == 1
    finished = room.answer(attempt, "setback", "pavel")
    assert finished["result"]["correct"] == 1 and finished["result"]["passed"] is True


def test_a_test_whose_words_all_left_the_deck_says_so(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    removed = client.delete(
        f"/api/decks/{room.deck_id}/words/{setup['words'][0]['id']}", headers=as_("olga")
    )
    assert removed.status_code == 200
    refused = room.start("pavel")
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "no_words")


def test_changing_the_words_asks_before_erasing_results(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    finished = room.take("pavel")
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    assert setup["results"] == 1
    gone = [setup["words"][0]["id"]]

    refused = room.save(excluded_word_ids=gone)
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "results_exist")
    assert names(room.detail()["passed"]) == ["Павел"]

    # Time and pass mark never touch results.
    assert room.save(minutes=5, pass_percent=100).status_code == 200
    assert names(room.detail()["passed"]) == ["Павел"]

    assert room.save(excluded_word_ids=gone, reset=True).status_code == 200
    detail = room.detail()
    assert detail["passed"] == [] and "Павел" in names(detail["not_taken"])
    gone_attempt = client.get(f"/api/test-attempts/{finished['id']}", headers=as_("pavel"))
    assert gone_attempt.status_code == 404
    # A new round: it can be taken again.
    assert room.start("pavel").status_code == 200


def test_the_group_page_counts_everyone_still_to_take_it(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    board = client.get(f"/api/groups/{room.group_id}/board", headers=as_("olga")).json()
    assert board["latest_test"] == {"title": "Unit 4", "passed": 1, "students": 2}
    # Once the owner takes it, they count as well.
    room.take("olga", wrong=2)
    board = client.get(f"/api/groups/{room.group_id}/board", headers=as_("olga")).json()
    assert board["latest_test"] == {"title": "Unit 4", "passed": 1, "students": 3}


def test_a_change_of_pass_mark_applies_to_results_already_in(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow", "ribbon"])
    room.ready()
    room.take("pavel", wrong=1)  # 4 of 5: exactly 80%
    assert names(room.detail()["passed"]) == ["Павел"]
    room.save(pass_percent=81)
    assert names(room.detail()["failed"]) == ["Павел"]


# --- the order ------------------------------------------------------------------------------


def test_two_students_get_their_own_order(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    pavel, ivan = (
        order_of(room.start("pavel").json()["id"]),
        order_of(room.start("ivan").json()["id"]),
    )
    assert sorted(pavel) == sorted(ivan)
    assert len(set(pavel)) == len(pavel)
    assert pavel != ivan  # 12! orders: a tie means the shuffle isn't independent


def test_each_new_practice_gets_a_new_order(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    orders = [order_of(room.take("pavel", kind="practice")["id"]) for _ in range(3)]
    assert orders[0] != orders[1] and orders[1] != orders[2]


def test_going_back_restores_the_exact_order_and_tiles(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    first = room.start("pavel").json()
    order = order_of(first["id"])
    second = room.answer(first, "zzz", "pavel")

    fetched = client.get(f"/api/test-attempts/{first['id']}", headers=as_("pavel")).json()
    again = room.start("pavel").json()  # the start button pressed again
    assert fetched == again == second
    assert order_of(first["id"]) == order


def test_answers_are_graded_by_word_whatever_the_order(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    attempt = room.start("pavel").json()
    with get_sessionmaker()() as db:
        questions = list(
            db.scalars(
                select(GroupTestQuestion).where(GroupTestQuestion.attempt_id == attempt["id"])
            )
        )
    random.Random(3).shuffle(questions)
    # Each word right, sent in an order unrelated to the one saved.
    for question in questions:
        response = client.post(
            f"/api/test-attempts/{attempt['id']}/answers",
            json={"question_id": question.key, "answer": question.headword},
            headers=as_("pavel"),
        ).json()
    assert response["result"]["correct"] == len(HEADWORDS)


def test_the_first_answer_stands(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    attempt = room.start("pavel").json()
    key = attempt["question"]["id"]
    room.answer(attempt, "zzz", "pavel")
    client.post(
        f"/api/test-attempts/{attempt['id']}/answers",
        json={"question_id": key, "answer": right_word(attempt["id"], key)},
        headers=as_("pavel"),
    )
    with get_sessionmaker()() as db:
        stored = question_at(db, attempt["id"], key)
        assert (stored.answer, stored.correct) == ("zzz", False)


def test_a_phrase_is_graded_with_its_gaps(client: TestClient) -> None:
    room = Class(client, ["carry out"])
    room.ready()
    attempt = room.start("pavel").json()
    assert attempt["question"]["separators"] == [{"after": 5, "char": " "}]
    assert room.answer(attempt, "Carry Out ", "pavel")["result"]["correct"] == 1


# --- nothing gives it away ------------------------------------------------------------------


def test_a_running_attempt_shows_neither_the_word_nor_its_id(client: TestClient) -> None:
    # `money` is a course word: its id is the word itself.
    room = Class(client, ["money", "setback"])
    room.ready()
    attempt = room.start("pavel").json()
    with get_sessionmaker()() as db:
        words = db.scalars(select(Word).where(Word.id.in_(order_of(attempt["id"])))).all()
    assert "money" in {item.id for item in words}
    secrets = {item.id for item in words} | {item.headword for item in words}
    # A test has no hints at all, the pronunciation of individual practice included (ADR 0047).
    assert attempt["question"]["pronunciation"] is None
    assert room.start("olga", "practice").json()["question"]["pronunciation"] is None

    # Every response along the way, up to the last word.
    while attempt["total"] - attempt["answered"] > 1:
        seen = json.dumps(attempt) + json.dumps(room.detail("pavel"))
        assert not [secret for secret in secrets if secret in seen]
        attempt = room.answer(attempt, "zzz", "pavel")
    seen = json.dumps(attempt) + json.dumps(room.detail("pavel"))
    assert not [secret for secret in secrets if secret in seen]
    assert attempt["result"] is None


def test_someone_elses_attempt_is_missing_to_me(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    attempt = room.start("pavel").json()
    for user in ("ivan", "olga", "stranger"):
        assert (
            client.get(f"/api/test-attempts/{attempt['id']}", headers=as_(user)).status_code == 404
        )
        answered = client.post(
            f"/api/test-attempts/{attempt['id']}/answers",
            json={"question_id": attempt["question"]["id"], "answer": "x"},
            headers=as_(user),
        )
        assert answered.status_code == 404


def test_a_question_of_another_attempt_is_refused(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    pavel, ivan = room.start("pavel").json(), room.start("ivan").json()
    response = client.post(
        f"/api/test-attempts/{pavel['id']}/answers",
        json={"question_id": ivan["question"]["id"], "answer": "x"},
        headers=as_("pavel"),
    )
    assert response.status_code == 404


# --- opening, and once only -----------------------------------------------------------------


def test_the_test_starts_only_while_open_and_closing_spares_who_began(client: TestClient) -> None:
    room = Class(client)
    assert room.start("pavel").status_code == 404  # nothing set up
    room.save()
    closed = room.start("pavel")
    assert (closed.status_code, closed.json()["error"]["code"]) == (409, "test_closed")

    room.open()
    began = room.start("pavel").json()
    room.open(False)
    assert room.start("ivan").json()["error"]["code"] == "test_closed"
    # Pavel carries on, to the end.
    assert room.start("pavel").json()["id"] == began["id"]
    assert room.answer(began, "zzz", "pavel")["answered"] == 1


def test_the_test_happens_once(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    room.take("pavel")
    again = room.start("pavel")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_taken")


def test_two_tabs_starting_at_the_same_moment_make_one_attempt(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both read «no attempt yet»: the database's unique index decides. The first read is forced
    stale, so the collision happens every run rather than when threads happen to meet."""
    room = Class(client)
    room.ready()
    first = room.start("pavel").json()
    real = group_tests._open_attempt
    calls = {"n": 0}

    def stale(*args: Any) -> Any:
        calls["n"] += 1
        return None if calls["n"] == 1 else real(*args)

    monkeypatch.setattr(group_tests, "_open_attempt", stale)
    user = db.scalars(select(User).where(User.auth_subject == "dev|pavel")).one()
    second = group_tests.start_attempt(db, user, room.group_id, room.deck_id, "test", False, NOW)
    assert str(second.id) == first["id"]
    assert (
        db.scalar(
            select(func.count())
            .select_from(GroupTestAttempt)
            .where(GroupTestAttempt.kind == "test")
        )
        == 1
    )


# --- the clock ------------------------------------------------------------------------------


def test_the_deadline_is_set_at_the_start_and_reloading_never_extends_it(
    client: TestClient,
) -> None:
    room = Class(client)
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    deadline = datetime.fromisoformat(attempt["deadline_at"])
    assert deadline == NOW + timedelta(minutes=5)
    later = NOW + timedelta(minutes=3)
    assert room.start("pavel", moment=later).json()["deadline_at"] == attempt["deadline_at"]
    # Changing the time for everyone else doesn't move a running clock.
    room.save(minutes=60)
    fetched = client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel", later)).json()
    assert fetched["deadline_at"] == attempt["deadline_at"]


def test_time_up_finishes_and_scores_what_was_saved(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow", "ribbon"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    second = room.answer(attempt, right_word(attempt["id"], attempt["question"]["id"]), "pavel")
    room.answer(second, "zzz", "pavel")

    up = NOW + timedelta(minutes=5)
    result = client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel", up)).json()
    assert result["question"] is None
    assert result["result"]["correct"] == 1 and result["result"]["total"] == 5
    assert result["result"]["passed"] is False and result["result"]["timed_out"] is True
    # The wrong answer, and three words never reached.
    answers = [mistake["answer"] for mistake in result["result"]["mistakes"]]
    assert answers.count("zzz") == 1 and answers.count(None) == 3
    with get_sessionmaker()() as db:
        stored = db.get_one(GroupTestAttempt, attempt["id"])
        assert stored.finished_at == up


def test_an_answer_held_up_in_the_grace_counts_and_a_later_one_does_not(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready(minutes=5)
    deadline = NOW + timedelta(minutes=5)

    pavel = room.start("pavel").json()
    right = right_word(pavel["id"], pavel["question"]["id"])
    within = room.answer(pavel, right, "pavel", deadline + GRACE)
    assert within["result"]["correct"] == 1  # counted, and the clock ends it there

    ivan = room.start("ivan").json()
    right = right_word(ivan["id"], ivan["question"]["id"])
    late = room.answer(ivan, right, "ivan", deadline + GRACE + timedelta(seconds=1))
    assert late["result"]["correct"] == 0
    with get_sessionmaker()() as db:
        assert question_at(db, ivan["id"], ivan["question"]["id"]).answer is None


def test_someone_else_looking_never_cuts_off_an_answer_on_its_way(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    deadline = NOW + timedelta(minutes=5)
    assert "Павел" in names(room.detail("olga", deadline + timedelta(seconds=5))["not_taken"])
    right = right_word(attempt["id"], attempt["question"]["id"])
    assert (
        room.answer(attempt, right, "pavel", deadline + timedelta(seconds=10))["result"]["correct"]
        == 1
    )


def test_a_student_who_never_comes_back_still_gets_a_result(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow", "ribbon"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    room.answer(attempt, right_word(attempt["id"], attempt["question"]["id"]), "pavel")

    during = room.detail("olga", NOW + timedelta(minutes=4))
    assert names(during["not_taken"]) == ["Иван", "Павел"]

    after = room.detail("olga", NOW + timedelta(minutes=6))
    assert names(after["failed"]) == ["Павел"]
    assert after["failed"][0]["score"] == {"correct": 1, "total": 5, "passed": False}
    board = client.get(
        f"/api/groups/{room.group_id}/board", headers=as_("olga", NOW + timedelta(minutes=6))
    ).json()
    # Of the two students, with Ivan still to take it; the owner set it and isn't counted.
    assert board["latest_test"] == {"title": "Unit 4", "passed": 0, "students": 2}


def test_a_timed_out_attempt_cannot_be_started_again(client: TestClient) -> None:
    room = Class(client)
    room.ready(minutes=5)
    room.start("pavel")
    again = room.start("pavel", moment=NOW + timedelta(minutes=5))
    assert again.json()["error"]["code"] == "already_taken"


# --- results and weak words -----------------------------------------------------------------


def test_results_are_open_to_the_group_without_ranking(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow", "ribbon"])
    board = client.get(f"/api/groups/{room.group_id}/board", headers=as_("olga")).json()
    client.post(
        f"/api/groups/join/{board['group']['invite_code']}",
        json={"nickname": "Анна"},
        headers=as_("anna"),
    )
    room.ready()
    room.take("pavel")
    room.take("anna", wrong=1)
    room.take("ivan", wrong=4)

    detail = room.detail("pavel")
    assert names(detail["passed"]) == ["Павел", "Анна"]
    assert detail["passed"][1]["score"] == {"correct": 4, "total": 5, "passed": True}
    assert names(detail["failed"]) == ["Иван"]
    assert detail["failed"][0]["score"]["correct"] == 1
    # The owner set it and hasn't taken it: not short of a result.
    assert names(detail["not_taken"]) == []
    assert names(room.detail("olga")["passed"]) == ["Анна", "Павел"]

    # Once the owner takes it, they are listed like anyone.
    room.take("olga")
    assert "Ольга" in names(room.detail("pavel")["passed"])

    board = client.get(f"/api/groups/{room.group_id}/board", headers=as_("ivan")).json()
    assert board["latest_test"] == {"title": "Unit 4", "passed": 3, "students": 4}
    listed = client.get(f"/api/groups/{room.group_id}/tests", headers=as_("ivan")).json()
    assert listed["decks"][0]["mine"] == {"correct": 1, "total": 5, "passed": False}


def test_practice_is_private_and_unlimited(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.save()  # not even opened: practice needs only a saved test
    for _ in range(3):
        finished = room.take("pavel", kind="practice")
        assert finished["deadline_at"] is None
        assert finished["result"]["passed"] is None
    detail = room.detail("olga")
    assert detail["passed"] == [] and detail["failed"] == []
    assert "Павел" in names(detail["not_taken"])
    assert (
        client.get(f"/api/groups/{room.group_id}/board", headers=as_("olga")).json()["latest_test"]
        is None
    )


def test_an_unfinished_practice_resumes_and_a_weak_one_replaces_it(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.save()
    room.take("pavel", wrong=1, kind="practice")
    left_open = room.start("pavel", "practice").json()
    room.answer(left_open, "zzz", "pavel")
    assert room.detail("pavel")["mine"]["practice_attempt_id"] == left_open["id"]
    assert room.start("pavel", "practice").json()["id"] == left_open["id"]

    weak = room.start("pavel", "practice", only_weak=True).json()
    assert weak["id"] != left_open["id"]
    assert weak["total"] == len(room.detail("pavel")["mine"]["weak"])


def test_practice_waits_for_a_running_test(client: TestClient) -> None:
    room = Class(client)
    room.ready(minutes=5)
    room.start("pavel")
    refused = room.start("pavel", "practice")
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "test_running")
    # With the time over, it is available again.
    assert room.start("pavel", "practice", NOW + timedelta(minutes=5)).status_code == 200


def test_weak_words_are_mine_and_leave_when_i_get_them_right(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready()
    finished = room.take("pavel", wrong=2)
    weak = room.detail("pavel")["mine"]["weak"]
    assert len(weak) == 2 and weak[0]["translation"].startswith("перевод ")
    assert {item["word"] for item in weak} == {
        mistake["word"] for mistake in finished["result"]["mistakes"]
    }
    # Nobody else sees them, nor do words I never answered wrongly count.
    assert room.detail("ivan")["mine"]["weak"] == []
    assert "weak" not in json.dumps(room.detail("olga")["failed"])

    tomorrow = NOW + timedelta(days=1)
    practice = room.start("pavel", "practice", tomorrow, only_weak=True).json()
    assert practice["total"] == 2
    while practice["question"]:
        right = right_word(practice["id"], practice["question"]["id"])
        practice = room.answer(practice, right, "pavel", tomorrow)
    assert room.detail("pavel")["mine"]["weak"] == []
    # The score in the group stays what the test gave.
    assert room.detail("pavel")["failed"][0]["score"]["correct"] == 1
    refused = room.start("pavel", "practice", only_weak=True)
    assert refused.json()["error"]["code"] == "no_words"


def test_words_never_reached_are_not_weak_but_are_in_the_result(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    room.start("pavel")
    assert room.detail("pavel", NOW + timedelta(minutes=5))["mine"]["weak"] == []


def test_a_running_test_hides_earlier_weak_words(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel", wrong=2, kind="practice")
    assert len(room.detail("pavel")["mine"]["weak"]) == 2
    room.start("pavel")
    mine = room.detail("pavel")["mine"]
    assert (mine["state"], mine["weak"]) == ("running", [])


# --- skipping --------------------------------------------------------------------------------


def _right(attempt: dict[str, Any]) -> str:
    return right_word(attempt["id"], attempt["question"]["id"])


def test_a_skipped_word_comes_back_after_the_others(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready()
    attempt = room.start("pavel").json()
    first = _right(attempt)
    assert attempt["returning"] is False

    attempt = room.skip(attempt, "pavel")
    assert _right(attempt) != first and attempt["returning"] is False
    assert attempt["answered"] == 1  # the bar moves on
    attempt = room.answer(attempt, _right(attempt), "pavel")
    attempt = room.answer(attempt, _right(attempt), "pavel")

    # Everything else done: the skipped word returns, marked so, and can still be answered right.
    assert _right(attempt) == first and attempt["returning"] is True
    assert attempt["answered"] == attempt["total"] == 3
    finished = room.answer(attempt, first, "pavel")
    assert finished["result"]["correct"] == 3 and finished["result"]["timed_out"] is False


def test_several_skipped_words_come_back_in_their_order(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready()
    attempt = room.start("pavel").json()
    order = [right_word(attempt["id"], key) for key in _keys(attempt["id"])]
    for _ in order:
        attempt = room.skip(attempt, "pavel")
    assert _right(attempt) == order[0] and attempt["returning"] is True
    attempt = room.answer(attempt, order[0], "pavel")
    assert _right(attempt) == order[1]


def test_skipping_a_word_again_is_final_and_counts_as_wrong(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    attempt = room.start("pavel").json()
    first = _right(attempt)
    attempt = room.skip(attempt, "pavel")
    attempt = room.answer(attempt, _right(attempt), "pavel")
    assert _right(attempt) == first
    finished = room.skip(attempt, "pavel", again=True)
    # Nothing left: the test ends there, with the skipped word wrong.
    assert (finished["result"]["correct"], finished["result"]["total"]) == (1, 2)
    assert finished["result"]["timed_out"] is False
    assert names(room.detail("pavel")["failed"]) == ["Павел"]


def test_skipping_every_word_twice_ends_the_test(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    attempt = room.start("pavel").json()
    attempt = room.skip(attempt, "pavel")
    assert attempt["returning"] is True  # the only word, back at once
    finished = room.skip(attempt, "pavel", again=True)
    assert (finished["result"]["correct"], finished["result"]["total"]) == (0, 1)


def test_repeating_a_skip_changes_nothing(client: TestClient) -> None:
    """A request retried after a slow answer must not make a first skip final."""
    room = Class(client, ["setback"])
    room.ready()
    attempt = room.start("pavel").json()
    first = room.skip(attempt, "pavel")
    second = room.skip(attempt, "pavel")
    assert first == second and second["result"] is None and second["returning"] is True


def test_a_skip_never_undoes_an_answer(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    attempt = room.start("pavel").json()
    right = _right(attempt)
    after = room.answer(attempt, right, "pavel")
    room.skip(attempt, "pavel")  # the old screen, retried: that word is answered already
    assert room.answer(after, _right(after), "pavel")["result"]["correct"] == 2


def test_a_skip_after_the_time_is_up_changes_nothing(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    late = NOW + timedelta(minutes=5) + GRACE + timedelta(seconds=1)
    finished = room.skip(attempt, "pavel", late)
    assert finished["result"]["timed_out"] is True
    with get_sessionmaker()() as db:
        assert question_at(db, attempt["id"], attempt["question"]["id"]).skips == 0


def test_the_clock_keeps_running_past_a_skip(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    deadline = attempt["deadline_at"]
    assert room.skip(attempt, "pavel", NOW + timedelta(minutes=1))["deadline_at"] == deadline
    finished = room.skip(attempt, "pavel", NOW + timedelta(minutes=5))
    assert finished["result"] is not None


def test_a_reload_finds_the_same_word_after_skips(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready()
    attempt = room.start("pavel").json()
    attempt = room.skip(attempt, "pavel")
    fetched = client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel")).json()
    assert fetched == attempt


def test_nobody_else_skips_my_word(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    attempt = room.start("pavel").json()
    body = {"question_id": attempt["question"]["id"]}
    url = f"/api/test-attempts/{attempt['id']}/skips"
    assert client.post(url, json=body, headers=as_("ivan")).status_code == 404
    other = room.start("ivan").json()
    theirs = {"question_id": other["question"]["id"]}
    assert client.post(url, json=theirs, headers=as_("pavel")).status_code == 404


def test_the_result_tells_wrong_skipped_and_unreached_apart(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow", "ribbon"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    keys = {key: right_word(attempt["id"], key) for key in _keys(attempt["id"])}
    wrong = keys[attempt["question"]["id"]]
    attempt = room.answer(attempt, "zzz", "pavel")
    skipped = keys[attempt["question"]["id"]]
    attempt = room.skip(attempt, "pavel")
    right = keys[attempt["question"]["id"]]
    attempt = room.answer(attempt, right, "pavel")

    # The other two are never reached before the time runs out.
    up = NOW + timedelta(minutes=5)
    result = client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel", up)).json()
    assert (result["result"]["correct"], result["result"]["total"]) == (1, 5)
    by_word = {item["word"]: item for item in result["result"]["mistakes"]}
    assert (by_word[wrong]["answer"], by_word[wrong]["skipped"]) == ("zzz", False)
    assert (by_word[skipped]["answer"], by_word[skipped]["skipped"]) == (None, True)
    unreached = set(keys.values()) - {wrong, skipped, right}
    assert len(unreached) == 2
    assert all(by_word[word]["answer"] is None for word in unreached)
    assert not any(by_word[word]["skipped"] for word in unreached)
    assert result["result"]["timed_out"] is True


def test_a_word_skipped_when_time_ran_out_counts_as_skipped(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    attempt = room.skip(attempt, "pavel")  # it has come back, and then the time is up
    up = NOW + timedelta(minutes=5)
    result = client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel", up)).json()
    assert result["result"]["mistakes"][0]["skipped"] is True
    assert result["result"]["timed_out"] is False


def test_skipped_words_are_weak_words_until_spelled_right(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    attempt = room.start("pavel").json()
    skipped = _right(attempt)
    attempt = room.skip(attempt, "pavel")
    attempt = room.answer(attempt, _right(attempt), "pavel")
    room.skip(attempt, "pavel", again=True)
    assert [item["word"] for item in room.detail("pavel")["mine"]["weak"]] == [skipped]

    tomorrow = NOW + timedelta(days=1)
    practice = room.start("pavel", "practice", tomorrow, only_weak=True).json()
    assert practice["total"] == 1
    room.answer(practice, skipped, "pavel", tomorrow)
    assert room.detail("pavel", tomorrow)["mine"]["weak"] == []


def test_practice_can_skip_too(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.save()
    attempt = room.start("pavel", "practice").json()
    assert room.skip(attempt, "pavel")["answered"] == 1


# --- retakes: one attempt each time the test opens --------------------------------------------


def score_of(rows: list[dict[str, Any]], nickname: str) -> dict[str, Any]:
    score: dict[str, Any] = next(row for row in rows if row["nickname"] == nickname)["score"]
    return score


def test_opening_again_gives_a_new_attempt_even_after_passing(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    assert room.detail("pavel")["mine"]["can_start"] is False

    room.open(False)
    closed = room.start("pavel")
    assert closed.json()["error"]["code"] == "test_closed"
    assert room.detail("pavel")["mine"]["can_start"] is False

    room.open()
    mine = room.detail("pavel")["mine"]
    assert (mine["can_start"], mine["state"]) == (True, "done")
    assert mine["score"]["passed"] is True  # the last result stays until there is a new one
    assert room.start("pavel").status_code == 200


def test_one_attempt_per_opening(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    room.open(False)
    room.open()
    room.take("pavel")
    again = room.start("pavel")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_taken")


def test_opening_an_open_test_gives_nothing_new(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    assert room.open().status_code == 200  # a second tab, or a double tap
    assert room.start("pavel").json()["error"]["code"] == "already_taken"


def test_the_group_sees_the_latest_attempt_in_both_directions(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    assert names(room.detail("ivan")["passed"]) == ["Павел"]

    def retake(wrong: int) -> None:
        room.open(False)
        room.open()
        room.take("pavel", wrong=wrong)

    # Better results come first in the data, then worse: the list follows the latest.
    retake(wrong=2)
    detail = room.detail("ivan")
    assert names(detail["failed"]) == ["Павел"] and detail["passed"] == []
    assert score_of(detail["failed"], "Павел")["correct"] == 0
    retake(wrong=0)
    assert names(room.detail("ivan")["passed"]) == ["Павел"]
    # Every attempt stays as data.
    with get_sessionmaker()() as db:
        assert db.scalar(select(func.count()).select_from(GroupTestAttempt)) == 3


def test_someone_mid_retake_keeps_their_old_score_in_the_list(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    room.open(False)
    room.open()
    room.start("pavel")
    assert names(room.detail("ivan")["passed"]) == ["Павел"]
    # They themselves see the test they are in, not the old result.
    mine = room.detail("pavel")["mine"]
    assert (mine["state"], mine["score"], mine["can_start"]) == ("running", None, False)


def test_a_student_who_does_not_retake_keeps_their_score(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    room.open(False)
    room.open()
    room.take("ivan", wrong=2)
    detail = room.detail("olga")
    assert names(detail["passed"]) == ["Павел"] and names(detail["failed"]) == ["Иван"]


def test_a_running_attempt_from_an_earlier_opening_resumes_on_its_own_clock(
    client: TestClient,
) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    began = room.start("pavel").json()
    room.open(False)
    room.open()
    resumed = room.start("pavel", moment=NOW + timedelta(minutes=1)).json()
    assert resumed["id"] == began["id"] and resumed["deadline_at"] == began["deadline_at"]
    # When that clock ends, this opening still has an attempt for them.
    later = NOW + timedelta(minutes=6)
    assert room.detail("pavel", later)["mine"]["can_start"] is True
    assert room.start("pavel", moment=later).json()["id"] != began["id"]


def test_two_tabs_retaking_make_one_attempt(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    room.open(False)
    room.open()
    first = room.start("pavel").json()
    real = group_tests._open_attempt
    calls = {"n": 0}

    def stale(*args: Any) -> Any:
        calls["n"] += 1
        return None if calls["n"] == 1 else real(*args)

    monkeypatch.setattr(group_tests, "_open_attempt", stale)
    user = db.scalars(select(User).where(User.auth_subject == "dev|pavel")).one()
    second = group_tests.start_attempt(db, user, room.group_id, room.deck_id, "test", False, NOW)
    assert str(second.id) == first["id"]


def test_changing_the_words_erases_every_opening(client: TestClient) -> None:
    room = Class(client)
    room.ready()
    room.take("pavel")
    room.open(False)
    room.open()
    room.take("pavel")
    room.open(False)
    setup = client.get(f"{room.url}/setup", headers=as_("olga")).json()
    assert setup["results"] == 2
    gone = [setup["words"][0]["id"]]
    assert room.save(excluded_word_ids=gone, reset=True).status_code == 200
    with get_sessionmaker()() as db:
        kinds = db.scalars(select(GroupTestAttempt.kind)).all()
    assert "test" not in kinds


def test_the_list_of_tests_says_when_an_attempt_is_waiting(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    listed = f"/api/groups/{room.group_id}/tests"
    assert client.get(listed, headers=as_("pavel")).json()["decks"][0]["can_start"] is True
    room.take("pavel")
    assert client.get(listed, headers=as_("pavel")).json()["decks"][0]["can_start"] is False
    room.open(False)
    room.open()
    deck = client.get(listed, headers=as_("pavel")).json()["decks"][0]
    assert deck["can_start"] is True and deck["mine"]["passed"] is True


# --- into «Трудные» ---------------------------------------------------------------------------


def hard_words(client: TestClient, user: str, moment: datetime = NOW) -> list[str]:
    """What «Трудные» holds for a student: the session they would start."""
    session = client.post(
        "/api/sessions",
        json={"kind": "spelling", "mode": "hard", "size": 30},
        headers=as_(user, moment),
    )
    if session.status_code == 409:
        return []
    assert session.status_code == 200, session.text
    return sorted(card["pronunciation"]["text"] for card in session.json()["exercises"])


def take_with(
    room: Class, user: str, wrong: int = 0, skip: int = 0, moment: datetime = NOW
) -> dict[str, list[str]]:
    """Answers wrongly, then skips for good, then the rest right. Returns which word went how."""
    attempt = room.start(user, moment=moment).json()
    went: dict[str, list[str]] = {"wrong": [], "skipped": [], "right": []}
    while attempt["question"]:
        word = _right(attempt)
        if len(went["wrong"]) < wrong:
            went["wrong"].append(word)
            attempt = room.answer(attempt, "zzz", user, moment)
        elif len(went["skipped"]) < skip or word in went["skipped"]:
            if word not in went["skipped"]:
                went["skipped"].append(word)
            attempt = room.skip(attempt, user, moment, again=attempt["returning"])
        else:
            went["right"].append(word)
            attempt = room.answer(attempt, word, user, moment)
    return went


def test_misspelled_and_skipped_words_reach_hard_words_and_right_ones_do_not(
    client: TestClient,
) -> None:
    room = Class(client, ["setback", "bargain", "harvest", "meadow"])
    room.ready()
    went = take_with(room, "pavel", wrong=1, skip=1)
    # Nothing in any lesson yet: words never met count all the same.
    assert hard_words(client, "pavel") == sorted(went["wrong"] + went["skipped"])
    assert not set(went["right"]) & set(hard_words(client, "pavel"))
    # And only for this student.
    assert hard_words(client, "ivan") == []


def test_the_deck_page_counts_them_for_someone_who_met_no_word(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    take_with(room, "pavel", wrong=2)
    stats = client.get(f"/api/decks/{room.deck_id}/stats", headers=as_("pavel")).json()
    assert stats["spelling_today"]["hard"] == 2
    assert stats["spelling_today"]["met"] == 0


def test_a_word_from_a_test_can_be_practised_there(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    session = client.post(
        "/api/sessions", json={"kind": "spelling", "mode": "hard"}, headers=as_("pavel")
    ).json()
    card = session["exercises"][0]
    assert "setback" not in str({k: v for k, v in card.items() if k != "pronunciation"})
    answered = client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={"exercise_id": card["id"], "response": {"kind": "spelling", "answer": "setback"}},
        headers=as_("pavel"),
    )
    assert answered.json()["correct"] is True
    done = client.post(f"/api/sessions/{session['id']}/complete", headers=as_("pavel"))
    assert done.status_code == 200, done.text


def test_words_the_time_ran_out_on_do_not_reach_hard_words(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain", "harvest"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    wrong = _right(attempt)
    attempt = room.answer(attempt, "zzz", "pavel")
    skipped = _right(attempt)
    attempt = room.skip(attempt, "pavel")
    up = NOW + timedelta(minutes=5)
    client.get(f"/api/test-attempts/{attempt['id']}", headers=as_("pavel", up))
    assert hard_words(client, "pavel", up) == sorted([wrong, skipped])


def test_an_attempt_closed_by_someone_elses_look_reaches_the_right_student(
    client: TestClient,
) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready(minutes=5)
    attempt = room.start("pavel").json()
    wrong = _right(attempt)
    room.answer(attempt, "zzz", "pavel")
    later = NOW + timedelta(minutes=6)
    assert names(room.detail("olga", later)["failed"]) == ["Павел"]
    assert hard_words(client, "pavel", later) == [wrong]
    assert hard_words(client, "olga", later) == []


def test_practice_in_the_group_does_not_reach_hard_words(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.save()
    room.take("pavel", wrong=2, kind="practice")
    assert hard_words(client, "pavel") == []
    assert len(room.detail("pavel")["mine"]["weak"]) == 2


def test_a_retake_reaches_hard_words_again_and_a_right_one_moves_nothing(
    client: TestClient, db: Session
) -> None:
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    room.open(False)
    room.open()
    take_with(room, "pavel")  # right this time
    assert hard_words(client, "pavel") == ["setback"]
    row = db.scalars(select(SpellingProgress)).one()
    assert (row.rung, row.misses) == (HARD, 1)


def test_a_word_the_student_could_spell_falls_back_to_hard(client: TestClient, db: Session) -> None:
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    db.execute(update(SpellingProgress).values(rung=KNOWN))
    db.commit()
    room.open(False)
    room.open()
    take_with(room, "pavel", wrong=1)
    db.expire_all()
    row = db.scalars(select(SpellingProgress)).one()
    assert (row.rung, row.misses) == (HARD, 2)


def test_a_word_deleted_mid_test_is_simply_left_out(client: TestClient) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    words = client.get(f"/api/decks/{room.deck_id}/edit", headers=as_("olga")).json()["words"]
    attempt = room.start("pavel").json()
    for item in words:
        removed = client.delete(
            f"/api/decks/{room.deck_id}/words/{item['word']['id']}", headers=as_("olga")
        )
        assert removed.status_code == 200
    while attempt["question"]:
        attempt = room.answer(attempt, "zzz", "pavel")
    assert attempt["result"]["correct"] == 0
    assert hard_words(client, "pavel") == []


def test_a_word_on_someones_hard_list_can_be_removed_from_its_deck(client: TestClient) -> None:
    """It leaves the deck and stays with the student, as a word someone met does."""
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    words = client.get(f"/api/decks/{room.deck_id}/edit", headers=as_("olga")).json()["words"]
    removed = client.delete(
        f"/api/decks/{room.deck_id}/words/{words[0]['word']['id']}", headers=as_("olga")
    )
    assert removed.status_code == 200, removed.text
    assert hard_words(client, "pavel") == ["setback"]


def test_a_deck_with_words_on_someones_hard_list_can_be_deleted(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    assert client.delete(f"/api/decks/{room.deck_id}", headers=as_("olga")).status_code == 204
    assert hard_words(client, "pavel") == []


def test_a_deck_someone_spelled_from_can_be_deleted(client: TestClient) -> None:
    """Failed before ADR 0048: spelling progress blocked deleting the deck's words."""
    deck = client.post("/api/decks", json={"title": "Свои"}, headers=as_("olga")).json()["id"]
    client.post(f"/api/decks/{deck}/words", json=word("setback"), headers=as_("olga"))
    lesson = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": deck}, headers=as_("olga")
    ).json()
    for card in lesson["exercises"]:
        client.post(
            f"/api/sessions/{lesson['id']}/attempts",
            json={"exercise_id": card["id"], "response": {"kind": "rating", "rating": 3}},
            headers=as_("olga"),
        )
    client.post(f"/api/sessions/{lesson['id']}/complete", headers=as_("olga"))
    session = client.post(
        "/api/sessions", json={"kind": "spelling", "mode": "today"}, headers=as_("olga")
    ).json()
    client.post(
        f"/api/sessions/{session['id']}/attempts",
        json={
            "exercise_id": session["exercises"][0]["id"],
            "response": {"kind": "spelling", "answer": "setback"},
        },
        headers=as_("olga"),
    )
    client.post(f"/api/sessions/{session['id']}/complete", headers=as_("olga"))
    assert client.delete(f"/api/decks/{deck}", headers=as_("olga")).status_code == 204


def test_deleting_the_account_of_someone_with_hard_words(client: TestClient) -> None:
    room = Class(client, ["setback"])
    room.ready()
    take_with(room, "pavel", wrong=1)
    assert client.delete("/api/me", headers=as_("pavel")).status_code == 204


# --- the deck and the group changing --------------------------------------------------------


def test_a_word_removed_or_rewritten_mid_test_changes_nothing_started(
    client: TestClient,
) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    attempt = room.start("pavel").json()
    words = client.get(f"/api/decks/{room.deck_id}/edit", headers=as_("olga")).json()["words"]
    client.delete(f"/api/decks/{room.deck_id}/words/{words[0]['word']['id']}", headers=as_("olga"))
    client.put(
        f"/api/decks/{room.deck_id}/words/{words[1]['word']['id']}",
        json=word("rewritten"),
        headers=as_("olga"),
    )
    while attempt["question"]:
        right = right_word(attempt["id"], attempt["question"]["id"])
        assert right != "rewritten"
        attempt = room.answer(attempt, right, "pavel")
    assert (attempt["result"]["correct"], attempt["result"]["total"]) == (2, 2)
    # Someone starting now gets only what is left, and the page says so.
    assert room.detail("ivan")["test"]["words"] == 1
    assert room.start("ivan").json()["total"] == 1


def test_a_deck_taken_back_hides_the_test_and_giving_it_again_restores_it(
    client: TestClient,
) -> None:
    room = Class(client)
    room.ready()
    finished = room.take("pavel")
    client.delete(f"/api/groups/{room.group_id}/decks/{room.deck_id}", headers=as_("olga"))
    assert client.get(room.url, headers=as_("pavel")).status_code == 404
    assert (
        client.get(f"/api/test-attempts/{finished['id']}", headers=as_("pavel")).status_code == 404
    )
    assert (
        client.get(f"/api/groups/{room.group_id}/tests", headers=as_("pavel")).json()["decks"] == []
    )
    client.post(
        f"/api/decks/{room.deck_id}/publish", json={"group_id": room.group_id}, headers=as_("olga")
    )
    assert names(room.detail("pavel")["passed"]) == ["Павел"]


def test_members_see_only_decks_with_a_test(client: TestClient) -> None:
    room = Class(client)
    tests = f"/api/groups/{room.group_id}/tests"
    assert client.get(tests, headers=as_("pavel")).json() == {"can_manage": False, "decks": []}
    olga = client.get(tests, headers=as_("olga")).json()
    assert olga["can_manage"] is True and olga["decks"][0]["has_test"] is False
    board = f"/api/groups/{room.group_id}/board"
    assert client.get(board, headers=as_("pavel")).json()["has_tests"] is False
    room.save()
    assert client.get(tests, headers=as_("pavel")).json()["decks"][0]["has_test"] is True
    assert client.get(board, headers=as_("pavel")).json()["has_tests"] is True
    # A deck taken back takes its test off the group's page too.
    client.delete(f"/api/groups/{room.group_id}/decks/{room.deck_id}", headers=as_("olga"))
    assert client.get(board, headers=as_("pavel")).json()["has_tests"] is False


@pytest.mark.parametrize("how", ["leaves", "removed", "account", "deck", "group"])
def test_results_go_with_who_or_what_they_belong_to(
    client: TestClient, db: Session, how: str
) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    pavel = db.scalar(select(GroupMember).where(GroupMember.nickname == "Павел"))
    assert pavel is not None
    pavel_id = pavel.id
    db.rollback()
    if how == "leaves":
        client.delete(f"/api/groups/{room.group_id}/members/me", headers=as_("pavel"))
    elif how == "removed":
        client.delete(f"/api/groups/{room.group_id}/members/{pavel_id}", headers=as_("olga"))
    elif how == "account":
        assert client.delete("/api/me", headers=as_("pavel")).status_code == 204
    elif how == "deck":
        assert client.delete(f"/api/decks/{room.deck_id}", headers=as_("olga")).status_code == 204
    else:
        assert client.delete(f"/api/groups/{room.group_id}", headers=as_("olga")).status_code == 204
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(GroupTestAttempt)) == 0
    assert db.scalar(select(func.count()).select_from(GroupTestQuestion)) == 0


# --- apart from learning --------------------------------------------------------------------


def test_a_test_is_not_a_lesson(client: TestClient) -> None:
    """It keeps no promise and moves no word's schedule. A miss reaches the spelling ladder (above),
    which is apart from a word's memory schedule."""
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel", wrong=1)
    room.take("pavel", kind="practice")
    with get_sessionmaker()() as db:
        for model in (LearningSession, ReviewAttempt, UserWordProgress):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    me = client.get(f"/api/groups/{room.group_id}/board", headers=as_("pavel")).json()
    assert next(row for row in me["rows"] if row["is_me"])["studied_today"] is False


def test_cleanup_removes_old_practice_and_keeps_tests(client: TestClient, db: Session) -> None:
    room = Class(client, ["setback", "bargain"])
    room.ready()
    room.take("pavel")
    room.take("pavel", kind="practice")
    recent = room.take("ivan", kind="practice")

    old = NOW - KEEP_ANSWERS - timedelta(days=1)
    db.execute(
        update(GroupTestAttempt)
        .where(GroupTestAttempt.kind == "practice", GroupTestAttempt.id != recent["id"])
        .values(started_at=old)
    )
    db.execute(
        update(GroupTestAttempt).where(GroupTestAttempt.kind == "test").values(started_at=old)
    )
    db.commit()

    clean_up(db, NOW)
    db.expire_all()
    left = db.execute(select(GroupTestAttempt.kind, func.count()).group_by(GroupTestAttempt.kind))
    assert {kind: count for kind, count in left} == {"test": 1, "practice": 1}
    assert names(room.detail("pavel")["passed"]) == ["Павел"]
