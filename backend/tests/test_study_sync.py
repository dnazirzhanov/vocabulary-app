"""Studying on the device (ADR 0062): answers given without a connection, sent later, leave the
server exactly as the same answers given online would; they count for the moment they were given,
within a guard; and the pack holds what a device needs to study by itself."""

import random
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    LearningSession,
    ReviewAttempt,
    SpellingProgress,
    StudyDayTotal,
    SyncDevice,
    User,
    UserWordProgress,
    Word,
)
from app.services import spelling_ladder
from app.services.cleanup import clean_up
from app.services.study_days import days_by_user
from tests.support import at, rate, spell

ZONE = "Asia/Bishkek"
BISHKEK = ZoneInfo(ZONE)
# 9 AM in Bishkek.
DAY0 = datetime(2026, 11, 2, 3, 0, tzinfo=UTC)


def as_(user: str, moment: datetime) -> dict[str, str]:
    return {"X-Dev-User": user} | at(moment, ZONE)


def fetch_pack(
    client: TestClient, user: str, device: UUID, moment: datetime, etag: str | None = None
) -> Any:
    headers = as_(user, moment) | ({"If-None-Match": etag} if etag else {})
    return client.get("/api/study/pack", params={"device_id": str(device)}, headers=headers)


def push(client: TestClient, user: str, ops: list[dict[str, Any]], moment: datetime) -> list[Any]:
    response = client.post(
        "/api/sync/push",
        json={"ops": ops, "pulled_at": moment.isoformat()},
        headers=as_(user, moment),
    )
    assert response.status_code == 200, response.text
    return [(result["status"], result.get("code")) for result in response.json()["results"]]


def answer(
    device: UUID,
    session: UUID,
    exercise: str,
    word: str,
    moment: datetime,
    response: dict[str, object],
    kind: str = "study",
    deck: str = "a1-a2",
    new: bool = False,
) -> dict[str, Any]:
    return {
        "op_id": str(uuid4()),
        "kind": "study.answer",
        "device_id": str(device),
        "session_id": str(session),
        "session_kind": kind,
        "deck_id": deck,
        "exercise_id": exercise,
        "word_id": word,
        "new": new,
        "response": response,
        "answered_at": moment.isoformat(),
    }


def finish_op(device: UUID, session: UUID, moment: datetime, set_aside: bool = False) -> Any:
    return {
        "op_id": str(uuid4()),
        "kind": "study.finish",
        "device_id": str(device),
        "session_id": str(session),
        "set_aside": set_aside,
        "finished_at": moment.isoformat(),
    }


def user_of(db: Session, name: str) -> User:
    db.expire_all()
    return db.scalars(select(User).where(User.auth_subject == f"dev|{name}")).one()


# --- the same answers, online and from a device ---------------------------------------------


def play_online(
    client: TestClient, db: Session, user: str, start: datetime, rng: random.Random
) -> list[dict[str, Any]]:
    """A lesson and the day's spelling answered online, one answer every 7 seconds; returns what
    was answered, in order, as a device would send it."""
    headers = as_(user, start)
    lesson = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=headers
    ).json()
    sent: list[dict[str, Any]] = []
    moment = start
    for kind, session in (("study", lesson), ("spelling", None)):
        if session is None:
            started = client.post(
                "/api/sessions",
                json={"kind": "spelling", "deck_id": "a1-a2"},
                headers=as_(user, moment),
            )
            if started.status_code == 409:
                break
            session = started.json()
        exercises = list(session["exercises"])
        index = 0
        while index < len(exercises):
            exercise = exercises[index]
            moment += timedelta(seconds=7)
            db.expire_all()
            planned = db.get_one(LearningSession, session["id"]).plan
            word = next(step["word_id"] for step in planned if step["id"] == exercise["id"])
            if kind == "study":
                response = rate(rng.choice((1, 2, 3, 3, 3, 4)))
            else:
                right = rng.random() < 0.7
                headword = db.get_one(Word, word).headword
                response = spell(headword if right else "wrong")
            result = client.post(
                f"/api/sessions/{session['id']}/attempts",
                json={"exercise_id": exercise["id"], "response": response},
                headers=as_(user, moment),
            ).json()
            sent.append(
                {
                    "kind": kind,
                    "session": session["id"],
                    "exercise": exercise["id"],
                    "word": word,
                    "new": exercise.get("new", False),
                    "response": response,
                    "at": moment,
                }
            )
            for added in result.get("inserted", []):
                exercises.insert(added["index"], added["exercise"])
            index += 1
        moment += timedelta(seconds=5)
        client.post(f"/api/sessions/{session['id']}/complete", headers=as_(user, moment))
        sent.append({"kind": "finish", "session": session["id"], "at": moment})
    return sent


def as_device_ops(device: UUID, played: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The same answers as a device sends them: its own session ids, the same moments."""
    ids: dict[str, UUID] = {}
    kinds: dict[str, str] = {}
    ops = []
    for item in played:
        session = ids.setdefault(item["session"], uuid4())
        if item["kind"] == "finish":
            ops.append(finish_op(device, session, item["at"]))
            continue
        kinds[item["session"]] = item["kind"]
        ops.append(
            answer(
                device,
                session,
                item["exercise"],
                item["word"],
                item["at"],
                item["response"],
                kind=item["kind"],
                new=item["new"],
            )
        )
    return ops


def state_of(db: Session, name: str) -> dict[str, Any]:
    """Everything the server keeps of a learner's studying, without ids that differ by design."""
    user = user_of(db, name)
    progress = {
        row.word_id: (
            row.fsrs_state,
            row.fsrs_step,
            row.stability,
            row.difficulty,
            row.due_at,
            row.last_reviewed_at,
            row.last_seen_at,
            row.introduced_at,
            row.first_recalled_at,
            row.review_count,
            row.lapses,
            row.correct_count,
            row.incorrect_count,
        )
        for row in db.scalars(select(UserWordProgress).where(UserWordProgress.user_id == user.id))
    }
    attempts = [
        (
            row.word_id,
            row.exercise_id,
            row.exercise_type,
            row.rating,
            row.correct,
            row.was_review,
            row.points,
            row.answered_at,
            row.due_after,
        )
        for row in db.scalars(
            select(ReviewAttempt)
            .where(ReviewAttempt.user_id == user.id)
            .order_by(ReviewAttempt.answered_at, ReviewAttempt.id)
        )
    ]
    ladder = {
        row.word_id: (row.rung, row.due_at, row.last_spelled_at, row.misses)
        for row in db.scalars(select(SpellingProgress).where(SpellingProgress.user_id == user.id))
    }
    lessons = [
        (row.kind, row.deck_id, row.completed_at, row.day_target, row.promised_days)
        for row in db.scalars(
            select(LearningSession)
            .where(LearningSession.user_id == user.id)
            .order_by(LearningSession.completed_at)
        )
    ]
    return {"progress": progress, "attempts": attempts, "ladder": ladder, "lessons": lessons}


def test_days_of_lessons_sent_later_leave_the_server_as_answering_online_would(
    client: TestClient, db: Session
) -> None:
    """Four days of lessons and spelling over a week, some cards forgotten and shown again, some
    words misspelled: answered online by one learner; the same answers at the same moments sent
    by another learner's device days later, all at once. Every schedule, answer, point, rung and
    finished lesson is the same."""
    rng = random.Random(62)
    device = uuid4()
    assert fetch_pack(client, "ben", device, DAY0 - timedelta(minutes=1)).status_code == 200
    played: list[dict[str, Any]] = []
    for day in (0, 1, 3, 6):
        played += play_online(client, db, "ana", DAY0 + timedelta(days=day), rng)
    assert sum(item["kind"] == "spelling" for item in played) > 5
    assert any(item.get("response", {}).get("rating") == 1 for item in played)

    answers = [item for item in played if item["kind"] == "study"]
    shown_again = any(
        sum(
            other["session"] == item["session"] and other["word"] == item["word"]
            for other in answers
        )
        > 1
        for item in answers
    )
    assert shown_again, "a forgotten card must come back within its lesson"

    ops = as_device_ops(device, played)
    sent_at = DAY0 + timedelta(days=7)
    results = [status for status, _ in push(client, "ben", ops, sent_at)]
    assert results == ["applied"] * len(ops)

    online, offline = state_of(db, "ana"), state_of(db, "ben")
    assert offline["progress"] == online["progress"]
    assert offline["attempts"] == online["attempts"]
    assert offline["ladder"] == online["ladder"]
    assert offline["lessons"] == online["lessons"]
    ana, ben = user_of(db, "ana"), user_of(db, "ben")
    # Each of the device's lessons holds the exercises it answered, in order, and nothing else.
    for lesson in db.scalars(select(LearningSession).where(LearningSession.user_id == ben.id)):
        answered = [
            op["exercise_id"]
            for op in ops
            if op["kind"] == "study.answer" and op["session_id"] == str(lesson.id)
        ]
        assert [step["id"] for step in lesson.plan] == answered
        assert lesson.origin == "device"
    since = DAY0 - timedelta(days=1)
    assert days_by_user(db, [ben], since)[ben.id] == days_by_user(db, [ana], since)[ana.id]


def test_answering_speed_comes_from_the_moments_answers_were_given(
    client: TestClient, db: Session
) -> None:
    """Sent together, answers still keep their own moments: the pace's answering time is the
    gap between them, not between their arrivals."""
    device = uuid4()
    fetch_pack(client, "ben", device, DAY0)
    pack = fetch_pack(client, "ben", device, DAY0).json()
    words = next(deck for deck in pack["decks"] if deck["id"] == "a1-a2")["word_ids"]
    session = uuid4()
    ops = [
        answer(device, session, f"c{n}", word, DAY0 + timedelta(seconds=9 * n), rate(3), new=True)
        for n, word in enumerate(words[:25], start=1)
    ]
    assert {status for status, _ in push(client, "ben", ops, DAY0 + timedelta(hours=5))} == {
        "applied"
    }
    pace = client.get(
        "/api/me/pace", params={"deck_id": "a1-a2"}, headers=as_("ben", DAY0 + timedelta(hours=5))
    ).json()
    assert pace["seconds_per_exercise"] == 9.0


# --- the day an answer counts for, and the guard --------------------------------------------


def test_a_lesson_given_offline_last_night_counts_for_last_night(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    fetch_pack(client, "ben", device, DAY0)
    evening = DAY0 + timedelta(hours=13)  # 10 PM in Bishkek, 2 November
    session = uuid4()
    pack = fetch_pack(client, "ben", device, DAY0).json()
    word = next(deck for deck in pack["decks"] if deck["id"] == "a1-a2")["word_ids"][0]
    ops = [
        answer(device, session, "c1", word, evening, rate(3), new=True),
        finish_op(device, session, evening + timedelta(seconds=30)),
    ]
    next_morning = DAY0 + timedelta(days=1, hours=1)
    assert push(client, "ben", ops, next_morning) == [("applied", None)] * 2
    ben = user_of(db, "ben")
    days = days_by_user(db, [ben], DAY0 - timedelta(days=1), BISHKEK)[ben.id]
    assert list(days) == [date(2026, 11, 2)]
    assert days[date(2026, 11, 2)].finished
    progress = db.get_one(UserWordProgress, (ben.id, word))
    assert progress.introduced_at == evening
    assert progress.last_reviewed_at == evening


def test_an_answer_dated_before_the_devices_last_contact_is_refused(
    client: TestClient, db: Session
) -> None:
    """Setting the phone's date back can't fill in a day the server has already seen."""
    device = uuid4()
    fetch_pack(client, "ben", device, DAY0 + timedelta(days=1))
    session = uuid4()
    yesterday = DAY0 + timedelta(hours=10)
    ops = [answer(device, session, "c1", "a1-a2-the", yesterday, rate(3), new=True)]
    assert push(client, "ben", ops, DAY0 + timedelta(days=1, hours=1)) == [
        ("rejected", "before_last_contact")
    ]
    ben = user_of(db, "ben")
    assert db.scalars(select(ReviewAttempt).where(ReviewAttempt.user_id == ben.id)).all() == []
    assert db.get(LearningSession, session) is None


def test_answers_from_the_future_long_ago_or_an_unknown_device_are_refused(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    fetch_pack(client, "ben", device, DAY0 - timedelta(days=40))
    now = DAY0
    words = fetch_pack(client, "ben", device, DAY0 - timedelta(days=40)).json()["decks"][0]
    word = words["word_ids"][0]

    def one(moment: datetime, sender: UUID = device) -> Any:
        return push(client, "ben", [answer(sender, uuid4(), "c1", word, moment, rate())], now)[0]

    assert one(now + timedelta(minutes=6)) == ("rejected", "in_future")
    assert one(now - timedelta(days=31)) == ("rejected", "too_old")
    assert one(now - timedelta(days=1), sender=uuid4()) == ("rejected", "unknown_device")
    # A few minutes ahead is the device's clock correction being slightly off: taken.
    assert one(now + timedelta(minutes=4)) == ("applied", None)
    assert one(now - timedelta(days=29)) == ("applied", None)


def test_an_answer_a_moment_before_the_contact_is_taken(client: TestClient, db: Session) -> None:
    """Another tab of the same device answered while the pack was on its way."""
    device = uuid4()
    contact = DAY0 + timedelta(hours=2)
    word = fetch_pack(client, "ben", device, contact).json()["decks"][0]["word_ids"][0]
    ops = [answer(device, uuid4(), "c1", word, contact - timedelta(minutes=2), rate(), new=True)]
    assert push(client, "ben", ops, contact + timedelta(minutes=1)) == [("applied", None)]
    late = [answer(device, uuid4(), "c1", word, contact - timedelta(minutes=6), rate())]
    assert push(client, "ben", late, contact + timedelta(minutes=1)) == [
        ("rejected", "before_last_contact")
    ]


# --- sent again, interrupted, two devices ---------------------------------------------------


def test_answers_sent_again_or_after_an_interruption_are_applied_once(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    pack = fetch_pack(client, "ben", device, DAY0).json()
    words = pack["decks"][0]["word_ids"][:4]
    session = uuid4()
    ops = [
        answer(device, session, f"c{n}", word, DAY0 + timedelta(seconds=10 * n), rate(), new=True)
        for n, word in enumerate(words, start=1)
    ] + [finish_op(device, session, DAY0 + timedelta(minutes=1))]
    later = DAY0 + timedelta(hours=1)
    # The connection dropped after the first two were applied; the device sends everything again.
    assert push(client, "ben", ops[:2], later) == [("applied", None)] * 2
    assert push(client, "ben", ops, later) == [("applied", None)] * 5
    assert push(client, "ben", ops, later) == [("applied", None)] * 5
    ben = user_of(db, "ben")
    attempts = db.scalars(select(ReviewAttempt).where(ReviewAttempt.user_id == ben.id)).all()
    assert sorted(attempt.exercise_id for attempt in attempts) == ["c1", "c2", "c3", "c4"]
    assert all(row.review_count == 0 for row in db.scalars(select(UserWordProgress)))
    # The same exercise sent under another op id (a bug on the device) changes nothing.
    again = answer(device, session, "c1", words[0], DAY0 + timedelta(seconds=10), rate(1))
    assert push(client, "ben", [again], later) == [("rejected", "session_closed")]


def test_two_devices_answering_one_word_offline_both_count(client: TestClient, db: Session) -> None:
    """The phone answered a word at 10:00, the tablet at 11:00; the tablet's arrives first. Each
    answer counts for its own moment; the schedule goes from the later one, never back in time."""
    phone, tablet = uuid4(), uuid4()
    word = fetch_pack(client, "ben", phone, DAY0).json()["decks"][0]["word_ids"][0]
    fetch_pack(client, "ben", tablet, DAY0)
    ten, eleven = DAY0 + timedelta(hours=1), DAY0 + timedelta(hours=2)
    noon = DAY0 + timedelta(hours=3)
    assert push(
        client, "ben", [answer(tablet, uuid4(), "c1", word, eleven, rate(3), new=True)], noon
    ) == [("applied", None)]
    ben = user_of(db, "ben")
    after_tablet = db.get_one(UserWordProgress, (ben.id, word))
    due_after_tablet = after_tablet.due_at
    assert push(
        client, "ben", [answer(phone, uuid4(), "c1", word, ten, rate(3), new=True)], noon
    ) == [("applied", None)]
    db.expire_all()
    progress = db.get_one(UserWordProgress, (ben.id, word))
    assert progress.introduced_at == eleven  # the first answer the server heard of
    assert progress.last_reviewed_at == eleven  # scheduled from the later answer
    assert progress.due_at >= due_after_tablet
    assert progress.review_count == 1
    moments = db.scalars(
        select(ReviewAttempt.answered_at)
        .where(ReviewAttempt.user_id == ben.id)
        .order_by(ReviewAttempt.answered_at)
    ).all()
    assert moments == [ten, eleven]
    # Only one of them introduced the word: the other earns no introduction points.
    points = db.scalars(select(ReviewAttempt.points).where(ReviewAttempt.user_id == ben.id)).all()
    assert sorted(points) == [0, 10]


def test_a_late_spelling_from_another_device_never_moves_the_ladder_back(
    client: TestClient, db: Session
) -> None:
    """The tablet spelled a word right at 11:00 and is heard first; the phone's miss at 10:00
    arrives after. The miss counts, as of the later try: the word goes back to «hard» but its
    last try stays 11:00."""
    phone, tablet = uuid4(), uuid4()
    word = fetch_pack(client, "ben", phone, DAY0).json()["decks"][0]["word_ids"][0]
    fetch_pack(client, "ben", tablet, DAY0)
    headword = db.get_one(Word, word).headword
    met = [answer(phone, uuid4(), "c1", word, DAY0 + timedelta(minutes=5), rate(), new=True)]
    ten, eleven = DAY0 + timedelta(hours=1), DAY0 + timedelta(hours=2)
    noon = DAY0 + timedelta(hours=3)
    right = answer(tablet, uuid4(), "s1", word, eleven, spell(headword), kind="spelling")
    miss = answer(phone, uuid4(), "s1", word, ten, spell("wrong"), kind="spelling")
    assert push(client, "ben", [*met, right, miss], noon) == [("applied", None)] * 3
    ben = user_of(db, "ben")
    rung = db.get_one(SpellingProgress, (ben.id, word))
    assert rung.rung == spelling_ladder.HARD
    assert rung.last_spelled_at == eleven
    assert rung.misses == 1


# --- whose lessons, which words -------------------------------------------------------------


def test_only_words_of_a_deck_i_study_and_only_my_own_lessons(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    word = fetch_pack(client, "ben", device, DAY0).json()["decks"][0]["word_ids"][0]
    fetch_pack(client, "ana", uuid4(), DAY0)
    later = DAY0 + timedelta(minutes=5)
    ana_deck = client.post(
        "/api/decks", json={"title": "Анины слова"}, headers=as_("ana", DAY0)
    ).json()
    ana_session = uuid4()
    ana_device = uuid4()
    fetch_pack(client, "ana", ana_device, DAY0)
    assert push(
        client, "ana", [answer(ana_device, ana_session, "c1", word, later, rate(), new=True)], later
    ) == [("applied", None)]

    def one(**fields: Any) -> Any:
        base = {"session": uuid4(), "word": word, "deck": "a1-a2", "kind": "study"}
        base |= fields
        op = answer(
            device,
            base["session"],
            "s1" if base["kind"] == "spelling" else "c1",
            base["word"],
            later,
            spell("x") if base["kind"] == "spelling" else rate(),
            kind=base["kind"],
            deck=base["deck"],
        )
        return push(client, "ben", [op], later)[0]

    assert one(deck=ana_deck["id"]) == ("rejected", "deck_not_found")
    assert one(word="b1-b2-whatever") == ("rejected", "word_not_found")
    assert one(session=ana_session) == ("rejected", "id_taken")
    assert one(kind="hard") == ("rejected", "not_met")
    assert one(kind="spelling") == ("rejected", "not_met")
    rating_in_spelling = answer(device, uuid4(), "s1", word, later, rate(), kind="spelling")
    assert push(client, "ben", [rating_in_spelling], later) == [("rejected", "wrong_response")]
    ben = user_of(db, "ben")
    assert db.scalars(select(ReviewAttempt).where(ReviewAttempt.user_id == ben.id)).all() == []


def test_a_devices_open_lesson_is_its_own(client: TestClient, db: Session) -> None:
    """Online lessons neither resume nor stop for it, and the per-card routes don't reach it."""
    device = uuid4()
    word = fetch_pack(client, "ben", device, DAY0).json()["decks"][0]["word_ids"][0]
    session = uuid4()
    push(client, "ben", [answer(device, session, "c1", word, DAY0, rate(), new=True)], DAY0)
    headers = as_("ben", DAY0 + timedelta(minutes=1))
    assert client.get("/api/sessions/active", headers=headers).json()["session"] is None
    assert client.get(f"/api/sessions/{session}", headers=headers).status_code == 404
    online = client.post(
        "/api/sessions", json={"kind": "study", "deck_id": "a1-a2"}, headers=headers
    )
    assert online.status_code == 200
    assert online.json()["id"] != str(session)


def test_a_lesson_left_for_another_is_set_aside_not_finished(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    word = fetch_pack(client, "ben", device, DAY0).json()["decks"][0]["word_ids"][0]
    session = uuid4()
    ops = [
        answer(device, session, "c1", word, DAY0, rate(), new=True),
        finish_op(device, session, DAY0 + timedelta(minutes=1), set_aside=True),
    ]
    assert push(client, "ben", ops, DAY0 + timedelta(minutes=2)) == [("applied", None)] * 2
    lesson = db.get_one(LearningSession, session)
    assert lesson.origin == "device"
    assert lesson.completed_at is None
    assert lesson.set_aside_at == DAY0 + timedelta(minutes=1)
    ben = user_of(db, "ben")
    day = days_by_user(db, [ben], DAY0 - timedelta(days=1), BISHKEK)[ben.id][date(2026, 11, 2)]
    assert not day.finished
    # Finishing what nothing was answered in, or someone else's: nothing to finish.
    assert push(client, "ben", [finish_op(device, uuid4(), DAY0)], DAY0) == [
        ("rejected", "session_not_found")
    ]


def test_a_finish_is_never_dated_before_the_lessons_own_answers(
    client: TestClient, db: Session
) -> None:
    device = uuid4()
    word = fetch_pack(client, "ben", device, DAY0).json()["decks"][0]["word_ids"][0]
    session = uuid4()
    answered = DAY0 + timedelta(minutes=10)
    ops = [
        answer(device, session, "c1", word, answered, rate(), new=True),
        finish_op(device, session, answered - timedelta(minutes=3)),
    ]
    assert push(client, "ben", ops, DAY0 + timedelta(hours=1)) == [("applied", None)] * 2
    assert db.get_one(LearningSession, session).completed_at == answered


def test_device_lessons_are_cleaned_up_and_their_days_kept(client: TestClient, db: Session) -> None:
    device = uuid4()
    word = fetch_pack(client, "ben", device, DAY0).json()["decks"][0]["word_ids"][0]
    session = uuid4()
    ops = [
        answer(device, session, "c1", word, DAY0, rate(), new=True),
        finish_op(device, session, DAY0 + timedelta(minutes=1)),
    ]
    push(client, "ben", ops, DAY0 + timedelta(days=2))
    ben = user_of(db, "ben")
    since = DAY0 - timedelta(days=1)
    before = days_by_user(db, [ben], since, BISHKEK)[ben.id]
    clean_up(db, DAY0 + timedelta(days=60))
    assert db.scalars(select(ReviewAttempt).where(ReviewAttempt.user_id == ben.id)).all() == []
    assert db.scalars(select(StudyDayTotal).where(StudyDayTotal.user_id == ben.id)).all()
    assert days_by_user(db, [ben], since, BISHKEK)[ben.id] == before


# --- the pack ---------------------------------------------------------------------------------


def test_the_pack_holds_my_decks_words_progress_and_pace(client: TestClient, db: Session) -> None:
    device = uuid4()
    first = fetch_pack(client, "ben", device, DAY0)
    assert first.status_code == 200
    pack = first.json()
    assert pack["time_zone"] == ZONE
    assert pack["course_open"] is True
    course = [deck for deck in pack["decks"] if deck["kind"] == "course"]
    assert [deck["id"] for deck in course] == ["a1-a2", "b1-b2", "c1"]
    words = {word["id"] for word in pack["words"]}
    assert all(set(deck["word_ids"]) <= words for deck in pack["decks"])
    assert course[0]["pace"] == {
        "daily_new": 5,
        "due_on": None,
        "extra_day": None,
        "extra_words": 0,
    }
    assert pack["progress"] == pack["ladder"] == pack["introduced"] == []
    contact = db.get_one(SyncDevice, (user_of(db, "ben").id, device))
    assert contact.last_contact_at == DAY0

    # My own deck, with its own pace; a lesson in the course.
    mine = client.post("/api/decks", json={"title": "Мои"}, headers=as_("ben", DAY0)).json()
    word = course[0]["word_ids"][0]
    session = uuid4()
    ops = [
        answer(device, session, "c1", word, DAY0 + timedelta(minutes=1), rate(3), new=True),
        finish_op(device, session, DAY0 + timedelta(minutes=2)),
    ]
    push(client, "ben", ops, DAY0 + timedelta(minutes=3))
    later = fetch_pack(client, "ben", device, DAY0 + timedelta(minutes=4)).json()
    assert [deck["id"] for deck in later["decks"] if deck["kind"] == "mine"] == [mine["id"]]
    [row] = later["progress"]
    assert row[0] == word and row[1] == 1  # learning
    assert later["introduced"] == [{"scope": "course", "day": "2026-11-02", "words": 1}]


def test_the_pack_is_not_sent_again_while_nothing_changed(client: TestClient, db: Session) -> None:
    device = uuid4()
    first = fetch_pack(client, "ben", device, DAY0)
    etag = first.headers["etag"]
    same = fetch_pack(client, "ben", device, DAY0 + timedelta(minutes=5), etag)
    assert same.status_code == 304
    assert same.content == b""
    # A contact all the same: answers from before it are refused.
    assert db.get_one(SyncDevice, (user_of(db, "ben").id, device)).last_contact_at == (
        DAY0 + timedelta(minutes=5)
    )
    word = first.json()["decks"][0]["word_ids"][0]
    moment = DAY0 + timedelta(minutes=6)
    push(client, "ben", [answer(device, uuid4(), "c1", word, moment, rate(), new=True)], moment)
    changed = fetch_pack(client, "ben", device, moment, etag)
    assert changed.status_code == 200
    assert changed.headers["etag"] != etag


def test_the_pack_names_a_device(client: TestClient) -> None:
    assert client.get("/api/study/pack", headers=as_("ben", DAY0)).status_code == 422
