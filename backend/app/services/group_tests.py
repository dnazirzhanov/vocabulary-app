"""A group's spelling tests (ADR 0046): one per deck of the group, not a live session.

The owner chooses the words, the time and the pass mark, and opens the test; anyone in the group
then starts alone, and their own timer runs from that tap. A `test` happens once and its score is
public in the group. `practice` is unlimited, untimed and private. Both leave a record of every
word, from which each student gets their own weak words.

The server is the only clock and the only source of order: an attempt's deadline and its shuffled
questions are saved when it starts, so nothing the device does can extend or reorder them. A student
who never comes back still gets a result, because any read of the test finishes expired attempts.
"""

import random
import secrets
from collections.abc import Iterable
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import (
    Deck,
    DeckAssignment,
    DeckWord,
    GroupMember,
    GroupTest,
    GroupTestAttempt,
    GroupTestQuestion,
    User,
    Word,
)
from app.schemas.group_tests import (
    AttemptKind,
    AttemptResultOut,
    MistakeOut,
    MyTestOut,
    ResultRowOut,
    SaveTestIn,
    ScoreOut,
    SetupWordOut,
    TestAttemptOut,
    TestDeckOut,
    TestDetailOut,
    TestSettingsOut,
    TestSetupOut,
    TestsOut,
    WeakWordOut,
)
from app.schemas.groups import LatestTestOut
from app.schemas.learning import SeparatorOut, SpellingExercise, SpellingPrompt
from app.services import spelling
from app.services.group_rights import can, require
from app.services.groups import membership

DEFAULT_PASS_PERCENT = 80
DEFAULT_MINUTES = 10
# How late an answer may arrive: the screen locked at the deadline, so this only saves one stuck in
# a slow or retried request on a busy server, which would otherwise cost a student a word.
GRACE = timedelta(seconds=20)


# --- pure rules -----------------------------------------------------------------------------


def is_pass(correct: int, total: int, pass_percent: int) -> bool:
    """Whole numbers, so 8 of 10 at 80% can't miss by a rounding error."""
    return total > 0 and correct * 100 >= pass_percent * total


def shuffled[T](items: Iterable[T], rng: random.Random) -> list[T]:
    """A new list in random order. `random.shuffle` is Fisher–Yates: every order equally likely."""
    result = list(items)
    rng.shuffle(result)
    return result


def _new_rng() -> random.Random:
    # Not seeded: one student's order says nothing about another's.
    return random.SystemRandom()


def _tiles(attempt_id: UUID, word_id: str, headword: str) -> list[str]:
    """Fixed by attempt and word, so going back to a question finds its tiles where they were."""
    return spelling.tiles(headword, random.Random(f"{attempt_id}:{word_id}"))  # noqa: S311


# --- finding things -------------------------------------------------------------------------


def _given_deck(
    db: Session, user: User, group_id: UUID, deck_id: str
) -> tuple[GroupMember, DeckAssignment, str]:
    """A deck given to a group I'm in, with its title; one taken back is as good as missing."""
    _, member = membership(db, user, group_id)
    row = db.execute(
        select(DeckAssignment, Deck.title)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .where(
            DeckAssignment.group_id == group_id,
            DeckAssignment.deck_id == deck_id,
            DeckAssignment.removed_at.is_(None),
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "test_not_found", "This deck is not in the group")
    return member, row[0], row[1]


def _test_of(db: Session, assignment: DeckAssignment) -> GroupTest | None:
    return db.scalar(select(GroupTest).where(GroupTest.assignment_id == assignment.id))


def _spellable_words(db: Session, deck_id: str) -> list[Word]:
    """The deck's words in its order, without any that has no letters to build."""
    words = db.scalars(
        select(Word)
        .join(DeckWord, DeckWord.word_id == Word.id)
        .where(DeckWord.deck_id == deck_id)
        .order_by(DeckWord.position)
    )
    return [word for word in words if spelling.letters(word.headword)]


def _questions(db: Session, attempt_id: UUID) -> list[GroupTestQuestion]:
    return list(
        db.scalars(
            select(GroupTestQuestion)
            .where(GroupTestQuestion.attempt_id == attempt_id)
            .order_by(GroupTestQuestion.position)
        )
    )


# --- finishing ------------------------------------------------------------------------------


def _finish(db: Session, attempt: GroupTestAttempt, now: datetime) -> None:
    """Scores what was saved; a word never answered counts as wrong. The caller holds the row."""
    correct, total = db.execute(
        select(
            func.count().filter(GroupTestQuestion.correct.is_(True)),
            func.count(),
        ).where(GroupTestQuestion.attempt_id == attempt.id)
    ).one()
    attempt.correct, attempt.total = correct, total
    attempt.finished_at = min(now, attempt.deadline_at) if attempt.deadline_at else now


def _settle(db: Session, attempt: GroupTestAttempt, now: datetime) -> None:
    """For the attempt's own student: past its deadline, it is over now, without waiting out the
    grace, because their device has already sent what it had."""
    if attempt.finished_at or attempt.deadline_at is None or now < attempt.deadline_at:
        return
    db.refresh(attempt, with_for_update=True)
    if attempt.finished_at is None:
        _finish(db, attempt, now)
    db.commit()


def _close_expired(db: Session, test_ids: list[UUID], now: datetime) -> None:
    """Attempts whose students never came back. After the grace, so that someone else's look at
    the results can't cut off an answer still on its way."""
    if not test_ids:
        return
    expired = db.scalars(
        select(GroupTestAttempt)
        .where(
            GroupTestAttempt.test_id.in_(test_ids),
            GroupTestAttempt.finished_at.is_(None),
            GroupTestAttempt.deadline_at < now - GRACE,
        )
        .with_for_update(skip_locked=True)
    ).all()
    if expired:
        for attempt in expired:
            _finish(db, attempt, now)
        db.commit()


# --- reading --------------------------------------------------------------------------------


def _score(attempt: GroupTestAttempt, test: GroupTest) -> ScoreOut:
    correct, total = attempt.correct or 0, attempt.total or 0
    return ScoreOut(correct=correct, total=total, passed=is_pass(correct, total, test.pass_percent))


def list_tests(db: Session, user: User, group_id: UUID, now: datetime) -> TestsOut:
    """The group's decks. Someone who can't set tests up sees only decks that have one."""
    _, member = membership(db, user, group_id)
    manager = can(member.role, "manage_tests")
    rows = db.execute(
        select(DeckAssignment.deck_id, Deck.title, GroupTest)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .outerjoin(GroupTest, GroupTest.assignment_id == DeckAssignment.id)
        .where(DeckAssignment.group_id == group_id, DeckAssignment.removed_at.is_(None))
        .order_by(DeckAssignment.assigned_at)
    ).all()
    tests = [test for _, _, test in rows if test is not None]
    _close_expired(db, [test.id for test in tests], now)
    mine = {
        attempt.test_id: attempt
        for attempt in db.scalars(
            select(GroupTestAttempt).where(
                GroupTestAttempt.test_id.in_([test.id for test in tests]),
                GroupTestAttempt.member_id == member.id,
                GroupTestAttempt.kind == "test",
                GroupTestAttempt.finished_at.is_not(None),
            )
        )
    }
    return TestsOut(
        can_manage=manager,
        decks=[
            TestDeckOut(
                deck_id=deck_id,
                title=title,
                has_test=test is not None,
                is_open=bool(test and test.is_open),
                mine=_score(mine[test.id], test) if test and test.id in mine else None,
            )
            for deck_id, title, test in rows
            if manager or test is not None
        ],
    )


def _latest_answers(
    db: Session, test: GroupTest, member: GroupMember
) -> list[tuple[str, bool | None, str, str]]:
    """Each word's latest answer in my finished attempts of either kind."""
    rows = db.execute(
        select(
            GroupTestQuestion.word_id,
            GroupTestQuestion.correct,
            GroupTestQuestion.headword,
            GroupTestQuestion.translation,
        )
        .join(GroupTestAttempt, GroupTestAttempt.id == GroupTestQuestion.attempt_id)
        .where(
            GroupTestAttempt.test_id == test.id,
            GroupTestAttempt.member_id == member.id,
            GroupTestAttempt.finished_at.is_not(None),
            GroupTestQuestion.answered_at.is_not(None),
        )
        .ext(distinct_on(GroupTestQuestion.word_id))
        .order_by(GroupTestQuestion.word_id, GroupTestQuestion.answered_at.desc())
    )
    return [(row[0], row[1], row[2], row[3]) for row in rows]


def _weak_words(db: Session, test: GroupTest, member: GroupMember) -> list[WeakWordOut]:
    """Words whose latest answer was wrong, so getting one right takes it off; only words still on
    the test."""
    on_test = set(test.word_ids)
    weak = [
        WeakWordOut(word=headword, translation=translation)
        for word_id, correct, headword, translation in _latest_answers(db, test, member)
        if not correct and word_id in on_test
    ]
    return sorted(weak, key=lambda item: item.word.casefold())


def _weak_word_ids(db: Session, test: GroupTest, member: GroupMember) -> set[str]:
    return {word_id for word_id, correct, _, _ in _latest_answers(db, test, member) if not correct}


def test_detail(
    db: Session, user: User, group_id: UUID, deck_id: str, now: datetime
) -> TestDetailOut:
    member, assignment, title = _given_deck(db, user, group_id, deck_id)
    manager = can(member.role, "manage_tests")
    test = _test_of(db, assignment)
    nothing = MyTestOut(
        state="none",
        attempt_id=None,
        deadline_at=None,
        score=None,
        practice_attempt_id=None,
        weak=[],
    )
    if test is None:
        return TestDetailOut(
            deck_id=deck_id,
            title=title,
            can_manage=manager,
            test=None,
            passed=[],
            failed=[],
            not_taken=[],
            mine=nothing,
        )

    mine = db.scalar(
        select(GroupTestAttempt).where(
            GroupTestAttempt.test_id == test.id,
            GroupTestAttempt.member_id == member.id,
            GroupTestAttempt.kind == "test",
        )
    )
    if mine is not None:
        _settle(db, mine, now)
    _close_expired(db, [test.id], now)

    finished = {
        attempt.member_id: attempt
        for attempt in db.scalars(
            select(GroupTestAttempt).where(
                GroupTestAttempt.test_id == test.id,
                GroupTestAttempt.kind == "test",
                GroupTestAttempt.finished_at.is_not(None),
            )
        )
    }
    members = db.scalars(select(GroupMember).where(GroupMember.group_id == group_id)).all()
    passed: list[ResultRowOut] = []
    failed: list[ResultRowOut] = []
    not_taken: list[ResultRowOut] = []
    # Me first, then alphabetical: a list of friends, never an order of merit (ADR 0039).
    for other in sorted(members, key=lambda m: (m.id != member.id, m.nickname.casefold())):
        attempt = finished.get(other.id)
        score = _score(attempt, test) if attempt else None
        row = ResultRowOut(
            member_id=other.id, nickname=other.nickname, is_me=other.id == member.id, score=score
        )
        if score is None:
            # Whoever sets the test isn't short of a result by not taking it.
            if not can(other.role, "manage_tests"):
                not_taken.append(row)
        else:
            (passed if score.passed else failed).append(row)

    practice = db.scalar(
        select(GroupTestAttempt.id).where(
            GroupTestAttempt.test_id == test.id,
            GroupTestAttempt.member_id == member.id,
            GroupTestAttempt.kind == "practice",
            GroupTestAttempt.finished_at.is_(None),
        )
    )
    running = mine is not None and mine.finished_at is None
    return TestDetailOut(
        deck_id=deck_id,
        title=title,
        can_manage=manager,
        test=TestSettingsOut(
            words=_words_left(db, test, deck_id),
            minutes=test.minutes,
            pass_percent=test.pass_percent,
            is_open=test.is_open,
        ),
        passed=passed,
        failed=failed,
        not_taken=not_taken,
        mine=MyTestOut(
            state="none" if mine is None else "running" if running else "done",
            attempt_id=mine.id if mine else None,
            deadline_at=mine.deadline_at if running and mine else None,
            score=_score(mine, test) if mine and not running else None,
            practice_attempt_id=practice,
            # While the clock runs, nothing may show how this student spells the test's words.
            weak=[] if running else _weak_words(db, test, member),
        ),
    )


def latest_test(db: Session, group_id: UUID, now: datetime) -> LatestTestOut | None:
    """The test last taken in the group, for the group page's line."""
    test_ids = list(
        db.scalars(
            select(GroupTest.id)
            .join(DeckAssignment, DeckAssignment.id == GroupTest.assignment_id)
            .where(DeckAssignment.group_id == group_id, DeckAssignment.removed_at.is_(None))
        )
    )
    if not test_ids:
        return None
    _close_expired(db, test_ids, now)
    newest = db.scalar(
        select(GroupTestAttempt.test_id)
        .where(
            GroupTestAttempt.test_id.in_(test_ids),
            GroupTestAttempt.kind == "test",
            GroupTestAttempt.finished_at.is_not(None),
        )
        .order_by(GroupTestAttempt.finished_at.desc())
        .limit(1)
    )
    if newest is None:
        return None
    test = db.get_one(GroupTest, newest)
    title = db.scalar(
        select(Deck.title)
        .join(DeckAssignment, DeckAssignment.deck_id == Deck.id)
        .where(DeckAssignment.id == test.assignment_id)
    )
    attempts = db.scalars(
        select(GroupTestAttempt).where(
            GroupTestAttempt.test_id == test.id,
            GroupTestAttempt.kind == "test",
            GroupTestAttempt.finished_at.is_not(None),
        )
    ).all()
    return LatestTestOut(
        title=title or "",
        passed=sum(_score(attempt, test).passed for attempt in attempts),
        taken=len(attempts),
    )


def _words_left(db: Session, test: GroupTest, deck_id: str) -> int:
    """The test's words still in the deck: what an attempt starting now would hold."""
    count = db.scalar(
        select(func.count())
        .select_from(DeckWord)
        .where(DeckWord.deck_id == deck_id, DeckWord.word_id.in_(test.word_ids))
    )
    return int(count or 0)


def _results_count(db: Session, test: GroupTest | None) -> int:
    if test is None:
        return 0
    count = db.scalar(
        select(func.count())
        .select_from(GroupTestAttempt)
        .where(GroupTestAttempt.test_id == test.id, GroupTestAttempt.kind == "test")
    )
    return int(count or 0)


def test_setup(db: Session, user: User, group_id: UUID, deck_id: str) -> TestSetupOut:
    member, assignment, title = _given_deck(db, user, group_id, deck_id)
    require(member.role, "manage_tests")
    test = _test_of(db, assignment)
    return TestSetupOut(
        title=title,
        words=[
            SetupWordOut(id=word.id, headword=word.headword, translation=word.translation)
            for word in _spellable_words(db, deck_id)
        ],
        saved=test is not None,
        question_count=test.question_count if test else None,
        excluded_word_ids=test.excluded_word_ids if test else [],
        pass_percent=test.pass_percent if test else DEFAULT_PASS_PERCENT,
        minutes=test.minutes if test else DEFAULT_MINUTES,
        results=_results_count(db, test),
    )


# --- setting up -----------------------------------------------------------------------------


def _chosen_words(
    test: GroupTest | None, pool: list[str], count: int | None, rng: random.Random
) -> list[str]:
    """The words of a test. A draw already made stays while it still fits: saving the same settings
    must not give everyone other words."""
    if count is None:
        return pool
    if test and test.question_count == count and set(test.word_ids) <= set(pool):
        return test.word_ids
    return shuffled(pool, rng)[:count]


def save_test(
    db: Session,
    user: User,
    group_id: UUID,
    deck_id: str,
    body: SaveTestIn,
    rng: random.Random | None = None,
) -> TestSetupOut:
    member, assignment, _ = _given_deck(db, user, group_id, deck_id)
    require(member.role, "manage_tests")
    test = _test_of(db, assignment)
    words = [word.id for word in _spellable_words(db, deck_id)]
    excluded = sorted(set(body.excluded_word_ids) & set(words))
    pool = [word for word in words if word not in excluded]
    if not pool:
        raise ApiError(422, "no_words", "A test needs at least one word")
    if body.question_count is not None and body.question_count > len(pool):
        raise ApiError(422, "too_many_words", f"There are only {len(pool)} words to choose from")

    chosen = _chosen_words(test, pool, body.question_count, rng or _new_rng())
    if test is not None and set(chosen) != set(test.word_ids):
        if _results_count(db, test) > 0 and not body.reset:
            raise ApiError(409, "results_exist", "Changing the words erases the results so far")
        # Practice stays: it is the student's own, and only words still on the test count from it.
        db.execute(
            delete(GroupTestAttempt).where(
                GroupTestAttempt.test_id == test.id, GroupTestAttempt.kind == "test"
            )
        )
    if test is None:
        test = GroupTest(assignment_id=assignment.id)
        db.add(test)
    test.word_ids = chosen
    test.excluded_word_ids = excluded
    test.question_count = body.question_count
    test.pass_percent = body.pass_percent
    test.minutes = body.minutes
    db.commit()
    return test_setup(db, user, group_id, deck_id)


def set_open(
    db: Session, user: User, group_id: UUID, deck_id: str, is_open: bool, now: datetime
) -> TestDetailOut:
    """Closing only stops new starts: anyone mid-test keeps the time they were given."""
    member, assignment, _ = _given_deck(db, user, group_id, deck_id)
    require(member.role, "manage_tests")
    test = _test_of(db, assignment)
    if test is None:
        raise ApiError(404, "test_not_found", "Set the test up first")
    test.is_open = is_open
    db.commit()
    return test_detail(db, user, group_id, deck_id, now)


# --- taking it ------------------------------------------------------------------------------


def _create_attempt(
    db: Session,
    test: GroupTest,
    member: GroupMember,
    kind: AttemptKind,
    words: list[Word],
    now: datetime,
    rng: random.Random,
) -> GroupTestAttempt | None:
    """A new attempt with its own shuffle saved; None if another tab has just made it."""
    attempt = GroupTestAttempt(
        test_id=test.id,
        member_id=member.id,
        kind=kind,
        started_at=now,
        deadline_at=now + timedelta(minutes=test.minutes) if kind == "test" else None,
    )
    db.add(attempt)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return None
    db.add_all(
        GroupTestQuestion(
            attempt_id=attempt.id,
            key=secrets.token_urlsafe(6),
            word_id=word.id,
            position=position,
            headword=word.headword,
            translation=word.translation,
            pos=word.pos,
        )
        for position, word in enumerate(shuffled(words, rng))
    )
    db.commit()
    return attempt


def _open_attempt(
    db: Session, test: GroupTest, member: GroupMember, kind: AttemptKind
) -> GroupTestAttempt | None:
    query = select(GroupTestAttempt).where(
        GroupTestAttempt.test_id == test.id,
        GroupTestAttempt.member_id == member.id,
        GroupTestAttempt.kind == kind,
    )
    if kind == "practice":
        query = query.where(GroupTestAttempt.finished_at.is_(None))
    return db.scalar(query)


def start_attempt(
    db: Session,
    user: User,
    group_id: UUID,
    deck_id: str,
    kind: AttemptKind,
    only_weak: bool,
    now: datetime,
    rng: random.Random | None = None,
) -> TestAttemptOut:
    """Starts an attempt, or returns the one already running with its saved order and deadline."""
    member, assignment, title = _given_deck(db, user, group_id, deck_id)
    test = _test_of(db, assignment)
    if test is None:
        raise ApiError(404, "test_not_found", "This deck has no test yet")

    my_test = _open_attempt(db, test, member, "test")
    if my_test is not None:
        _settle(db, my_test, now)
    test_running = my_test is not None and my_test.finished_at is None

    existing = my_test if kind == "test" else None
    if kind == "test":
        if my_test is not None and my_test.finished_at is not None:
            raise ApiError(409, "already_taken", "The test can be taken once")
        if my_test is None and not test.is_open:
            raise ApiError(409, "test_closed", "The test is not open")
    else:
        # Practice shows the right words at its end, so it waits for the timed test to finish.
        if test_running:
            raise ApiError(409, "test_running", "Finish the test first")
        existing = _open_attempt(db, test, member, "practice")
        if existing is not None and only_weak:
            # A narrower practice replaces a long one left open; what was answered still counts.
            db.refresh(existing, with_for_update=True)
            if existing.finished_at is None:
                _finish(db, existing, now)
            db.commit()
            existing = None
    if existing is not None:
        return _attempt_out(db, existing, test, deck_id, title)

    wanted = set(test.word_ids)
    if only_weak:
        wanted &= _weak_word_ids(db, test, member)
    words = [word for word in _spellable_words(db, deck_id) if word.id in wanted]
    if not words:
        raise ApiError(409, "no_words", "There are no words to test")
    created = _create_attempt(db, test, member, kind, words, now, rng or _new_rng())
    if created is None:
        created = _open_attempt(db, test, member, kind)
        if created is None:
            raise ApiError(409, "attempt_conflict", "Try again")
    return _attempt_out(db, created, test, deck_id, title)


def _my_attempt(
    db: Session, user: User, attempt_id: UUID, lock: bool = False
) -> tuple[GroupTestAttempt, GroupTest, str, str]:
    """My attempt, its test, deck id and title. Anyone else's looks missing, as does one erased by
    a change of the test's words or a deck taken back."""
    query = (
        select(GroupTestAttempt, GroupTest, DeckAssignment.deck_id, Deck.title)
        .join(GroupTest, GroupTest.id == GroupTestAttempt.test_id)
        .join(DeckAssignment, DeckAssignment.id == GroupTest.assignment_id)
        .join(Deck, Deck.id == DeckAssignment.deck_id)
        .join(GroupMember, GroupMember.id == GroupTestAttempt.member_id)
        .where(
            GroupTestAttempt.id == attempt_id,
            GroupMember.user_id == user.id,
            DeckAssignment.removed_at.is_(None),
        )
    )
    if lock:
        query = query.with_for_update(of=GroupTestAttempt)
    row = db.execute(query).one_or_none()
    if row is None:
        raise ApiError(404, "attempt_not_found", "This attempt no longer exists")
    return row[0], row[1], row[2], row[3]


def _attempt_out(
    db: Session, attempt: GroupTestAttempt, test: GroupTest, deck_id: str, title: str
) -> TestAttemptOut:
    questions = _questions(db, attempt.id)
    answered = sum(question.answered_at is not None for question in questions)
    question: SpellingExercise | None = None
    result: AttemptResultOut | None = None
    if attempt.finished_at is None:
        current = next(item for item in questions if item.answered_at is None)
        # The meaning only: no word, no word id.
        question = SpellingExercise(
            id=current.key,
            prompt=SpellingPrompt(translation=current.translation, pos=current.pos),
            slots=len(spelling.letters(current.headword)),
            separators=[
                SeparatorOut(after=after, char=char)
                for after, char in spelling.separators(current.headword)
            ],
            tiles=_tiles(attempt.id, current.word_id, current.headword),
        )
    else:
        correct, total = attempt.correct or 0, attempt.total or 0
        result = AttemptResultOut(
            correct=correct,
            total=total,
            passed=is_pass(correct, total, test.pass_percent) if attempt.kind == "test" else None,
            timed_out=answered < total,
            mistakes=[
                MistakeOut(translation=item.translation, word=item.headword, answer=item.answer)
                for item in questions
                if not item.correct
            ],
        )
    return TestAttemptOut(
        id=attempt.id,
        kind="test" if attempt.kind == "test" else "practice",
        deck_id=deck_id,
        title=title,
        answered=answered,
        total=len(questions),
        deadline_at=attempt.deadline_at if attempt.finished_at is None else None,
        question=question,
        result=result,
    )


def get_attempt(db: Session, user: User, attempt_id: UUID, now: datetime) -> TestAttemptOut:
    attempt, test, deck_id, title = _my_attempt(db, user, attempt_id)
    _settle(db, attempt, now)
    return _attempt_out(db, attempt, test, deck_id, title)


def answer_question(
    db: Session, user: User, attempt_id: UUID, question_id: str, answer: str, now: datetime
) -> TestAttemptOut:
    """Graded by the question's own word, wherever it stood in the order. The first answer stands,
    so a retried request changes nothing. The lock keeps the last answer and the clock from both
    finishing the attempt."""
    attempt, test, deck_id, title = _my_attempt(db, user, attempt_id, lock=True)
    if attempt.finished_at is None:
        late = attempt.deadline_at is not None and now > attempt.deadline_at + GRACE
        if not late:
            question = db.scalar(
                select(GroupTestQuestion).where(
                    GroupTestQuestion.attempt_id == attempt.id,
                    GroupTestQuestion.key == question_id,
                )
            )
            if question is None:
                raise ApiError(404, "question_not_found", "No such question in this attempt")
            if question.answered_at is None:
                question.answer = answer
                question.correct = spelling.is_correct(answer, question.headword)
                question.answered_at = now
                db.flush()
        remaining = db.scalar(
            select(func.count())
            .select_from(GroupTestQuestion)
            .where(
                GroupTestQuestion.attempt_id == attempt.id,
                GroupTestQuestion.answered_at.is_(None),
            )
        )
        over = attempt.deadline_at is not None and now >= attempt.deadline_at
        if not remaining or over:
            _finish(db, attempt, now)
    db.commit()
    return _attempt_out(db, attempt, test, deck_id, title)
