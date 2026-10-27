"""Study sessions backed by the database: start, resume, answer, complete (ADR 0012, 0016).

Every state change happens in one transaction, and a uniqueness constraint keeps exactly one rating
per showing, so retries and double taps are harmless (ADR 0003). Scheduling lives in
services/scheduling.py (FSRS), queue rules in services/learning.py. The current time is always
passed in, never read here.
"""

import random
from collections.abc import Callable, Iterable, Sequence
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import (
    Deck,
    DeckWord,
    LearningSession,
    ReviewAttempt,
    User,
    UserWordProgress,
    UserWordSpelling,
    Word,
)
from app.schemas.learning import (
    ActiveSessionOut,
    AttemptIn,
    AttemptResultOut,
    CardExercise,
    CourseGoalOut,
    DeckOut,
    ExerciseOut,
    InsertedExercise,
    IntervalPreview,
    RatingCounts,
    RatingResponse,
    SessionOut,
    SpellGuidedExercise,
    SpellingPrompt,
    SpellingResponse,
    SpellingSummaryOut,
    SpellRecallExercise,
    StartHardSession,
    StartRequest,
    StartStudySession,
    SummaryOut,
    SummaryWord,
    WordOut,
)
from app.services import groups, pace, spelling
from app.services.learning import (
    HARD_CARDS_PER_SESSION,
    REQUEUE_WITHIN_SECONDS,
    REVIEW_CARDS_PER_SESSION,
    PlannedExercise,
    after_miss,
    pick_new_words,
    plan_cards,
    plan_spelling,
    requeue,
)
from app.services.progress import card_points
from app.services.progress_view import today_plan
from app.services.scheduling import (
    AGAIN,
    LEARNING,
    RELEARNING,
    CardState,
    local_date,
    previews,
    review,
)

TileMaker = Callable[[str, str], list[str]]

# --- reading ---------------------------------------------------------------------------------


def _word_out(word: Word) -> WordOut:
    return WordOut(
        id=word.id,
        headword=word.headword,
        pos=word.pos,
        translation=word.translation,
        example=word.example,
        example_ru=word.example_ru,
        illustration=word.illustration,
    )


def _deck_words(db: Session, deck_id: str) -> list[Word]:
    return list(
        db.scalars(
            select(Word)
            .join(DeckWord, DeckWord.word_id == Word.id)
            .where(DeckWord.deck_id == deck_id)
            .order_by(DeckWord.position)
        )
    )


def _words_by_id(db: Session, ids: Iterable[str]) -> dict[str, Word]:
    return {word.id: word for word in db.scalars(select(Word).where(Word.id.in_(set(ids))))}


def _plan(session: LearningSession) -> list[PlannedExercise]:
    return [PlannedExercise.from_json(step) for step in session.plan]


def _attempts(db: Session, session_id: UUID) -> dict[str, ReviewAttempt]:
    attempts = db.scalars(select(ReviewAttempt).where(ReviewAttempt.session_id == session_id))
    return {attempt.exercise_id: attempt for attempt in attempts}


def _progress(db: Session, user: User, word_ids: Iterable[str]) -> dict[str, UserWordProgress]:
    rows = db.scalars(
        select(UserWordProgress).where(
            UserWordProgress.user_id == user.id, UserWordProgress.word_id.in_(set(word_ids))
        )
    )
    return {row.word_id: row for row in rows}


def _card_state(progress: UserWordProgress | None) -> CardState | None:
    if progress is None:
        return None
    return CardState(
        state=progress.fsrs_state,
        step=progress.fsrs_step,
        stability=progress.stability,
        difficulty=progress.difficulty,
        due_at=progress.due_at,
        last_reviewed_at=progress.last_reviewed_at,
    )


def _owned_session(db: Session, user: User, session_id: UUID) -> LearningSession:
    # Someone else's session is indistinguishable from a missing one (no id probing).
    session = db.scalar(
        select(LearningSession).where(
            LearningSession.id == session_id, LearningSession.user_id == user.id
        )
    )
    if session is None:
        raise ApiError(404, "session_not_found", "Session not found")
    return session


def _open_session(db: Session, user: User) -> LearningSession | None:
    return db.scalar(
        select(LearningSession).where(
            LearningSession.user_id == user.id, LearningSession.completed_at.is_(None)
        )
    )


def _card_out(
    step: PlannedExercise, word: Word, progress: UserWordProgress | None, now: datetime
) -> CardExercise:
    return CardExercise(
        id=step.id,
        word=_word_out(word),
        new=step.new,
        previews=[
            IntervalPreview(rating=rating, seconds=round(delay.total_seconds()))
            for rating, delay in previews(_card_state(progress), now).items()
        ],
    )


def _exercise_out(
    step: PlannedExercise, word: Word, progress: UserWordProgress | None, now: datetime
) -> ExerciseOut:
    if step.type == "spell_guided":
        return SpellGuidedExercise(id=step.id, word=_word_out(word), tiles=list(step.tiles))
    if step.type == "spell_recall":
        # The meaning only: no headword, id, example or audio can give the answer away.
        return SpellRecallExercise(
            id=step.id,
            prompt=SpellingPrompt(
                translation=word.translation, pos=word.pos, example_ru=word.example_ru
            ),
            slots=len(word.headword),
            tiles=list(step.tiles),
            retry=step.retry,
        )
    return _card_out(step, word, progress, now)


def _result_out(
    attempt: ReviewAttempt, headword: str, inserted: Sequence[InsertedExercise] = ()
) -> AttemptResultOut:
    if attempt.exercise_type == "card":
        assert attempt.rating is not None and attempt.due_after is not None
        return AttemptResultOut(
            exercise_id=attempt.exercise_id,
            rating=attempt.rating,
            next_due_at=attempt.due_after,
            inserted=list(inserted),
        )
    return AttemptResultOut(
        exercise_id=attempt.exercise_id,
        correct=attempt.correct,
        hint_used=attempt.hint_used,
        answer=headword,
        inserted=list(inserted),
    )


def present_session(db: Session, user: User, session: LearningSession, now: datetime) -> SessionOut:
    plan = _plan(session)
    word_ids = [step.word_id for step in plan]
    words = _words_by_id(db, word_ids)
    progress = _progress(db, user, word_ids)
    attempts = _attempts(db, session.id)
    return SessionOut(
        id=session.id,
        kind=session.kind,
        deck_id=session.deck_id,
        completed=session.completed_at is not None,
        exercises=[
            _exercise_out(step, words[step.word_id], progress.get(step.word_id), now)
            for step in plan
        ],
        results=[
            _result_out(attempts[step.id], words[step.word_id].headword)
            for step in plan
            if step.id in attempts
        ],
    )


def _course_rows(db: Session, user: User, now: datetime) -> list[Any]:
    """Published decks in level order, with the learner's counts on each."""
    word_count = (
        select(func.count()).where(DeckWord.deck_id == Deck.id).correlate(Deck).scalar_subquery()
    )
    mine = (
        select(UserWordProgress)
        .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
        .where(DeckWord.deck_id == Deck.id, UserWordProgress.user_id == user.id)
        .correlate(Deck)
        .subquery()
    )
    introduced = select(func.count()).select_from(mine).scalar_subquery()
    due = select(func.count()).select_from(mine).where(mine.c.due_at <= now).scalar_subquery()
    # Anki's "Learn" column: due cards still in short learning or relearning steps.
    learning = (
        select(func.count())
        .select_from(mine)
        .where(mine.c.due_at <= now, mine.c.fsrs_state.in_((LEARNING, RELEARNING)))
        .scalar_subquery()
    )
    next_due = select(func.min(mine.c.due_at)).where(mine.c.due_at > now).scalar_subquery()
    return list(
        db.execute(
            select(Deck, word_count, introduced, due, learning, next_due)
            .where(Deck.status == "published")
            .order_by(Deck.level_order, Deck.id)
        )
    )


def _current_index(rows: list[Any]) -> int:
    """The level the learner is on: the first with words still to meet (the last when all are
    met). Later levels are locked until it is done (ADR 0014)."""
    for index, (_, words, met, *_) in enumerate(rows):
        if met < words:
            return index
    return max(0, len(rows) - 1)


def list_decks(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> list[DeckOut]:
    rows = _course_rows(db, user, now)
    if not rows:
        return []
    current = _current_index(rows)
    today = pace.day_plan(db, user, rows[current][0].id, now, time_zone)
    allowance = 0 if today.blocked_by_reviews else today.remaining
    return [
        DeckOut(
            id=deck.id,
            title=deck.title,
            description=deck.description,
            level=deck.level,
            level_order=deck.level_order,
            locked=index > current,
            course_goal=CourseGoalOut(
                target_words=deck.goal_words, coverage_percent=deck.goal_coverage_percent
            )
            if deck.goal_words and deck.goal_coverage_percent
            else None,
            word_count=words,
            introduced_count=met,
            due_count=due_now,
            learning_count=learning,
            review_count=due_now - learning,
            new_today=min(allowance, words - met) if index == current else 0,
            next_due_at=upcoming,
        )
        for index, (deck, words, met, due_now, learning, upcoming) in enumerate(rows)
    ]


def active_session(db: Session, user: User, now: datetime) -> ActiveSessionOut:
    session = _open_session(db, user)
    return ActiveSessionOut(session=present_session(db, user, session, now) if session else None)


def get_session(db: Session, user: User, session_id: UUID, now: datetime) -> SessionOut:
    return present_session(db, user, _owned_session(db, user, session_id), now)


# --- starting --------------------------------------------------------------------------------


def require_published_deck(db: Session, deck_id: str) -> Deck:
    deck = db.get(Deck, deck_id)
    if deck is None or deck.status != "published":
        raise ApiError(404, "deck_not_found", "Deck not found")
    return deck


def _study_plan(
    db: Session, user: User, request: StartStudySession, now: datetime, time_zone: ZoneInfo
) -> tuple[str, list[PlannedExercise], int, int]:
    """One deck: its due cards, most overdue first, then its new words as today's pace allows
    (ADR 0010). No deck («Продолжить»): due cards of every level, then the current level's new
    words, so earlier levels keep coming back (ADR 0014). After the cards, spelling: today's new
    words, guided then recalled, and the spelling reviews due (ADR 0016). Also returns the day's
    plan to record (pace.recorded_target) and the words in the spelling section."""
    rows = _course_rows(db, user, now)
    current = _current_index(rows)
    if request.deck_id is None:
        if not rows:
            raise ApiError(404, "deck_not_found", "No decks are published")
        deck = rows[current][0]
    else:
        deck = require_published_deck(db, request.deck_id)
        position = next((i for i, row in enumerate(rows) if row[0].id == deck.id), current)
        if position > current:
            raise ApiError(409, "deck_locked", "Finish the previous level first")
    due_query = select(UserWordProgress.word_id).where(
        UserWordProgress.user_id == user.id, UserWordProgress.due_at <= now
    )
    if request.deck_id is not None:
        due_query = due_query.join(DeckWord, DeckWord.word_id == UserWordProgress.word_id).where(
            DeckWord.deck_id == deck.id
        )
    due = list(
        db.scalars(
            due_query.order_by(UserWordProgress.due_at, UserWordProgress.word_id).limit(
                REVIEW_CARDS_PER_SESSION
            )
        )
    )
    today = pace.day_plan(db, user, deck.id, now, time_zone)
    new: list[str] = []
    if not today.blocked_by_reviews:
        introduced = set(
            db.scalars(select(UserWordProgress.word_id).where(UserWordProgress.user_id == user.id))
        )
        order = [word.id for word in _deck_words(db, deck.id)]
        new = pick_new_words(order, introduced, today.next_lesson_size)
    reviews = _spelling_due(db, user, now, exclude=set(new))
    if not due and not new and not reviews:
        if today.blocked_by_reviews:
            raise ApiError(409, "reviews_first", "Too many reviews are due: review first")
        raise ApiError(409, "nothing_to_study", "Nothing is due and no new words are left")
    cards = plan_cards(due, new)
    steps = cards + plan_spelling(new, reviews, len(cards) + 1, _tile_maker(db, user, now))
    target = pace.recorded_target(today, pace.words_left(db, user))
    return deck.id, steps, target, len(set(new) | set(reviews))


def _spelling_due(db: Session, user: User, now: datetime, exclude: set[str]) -> list[str]:
    """Words due for a spelling recall on a later day, most overdue first."""
    rows = db.scalars(
        select(UserWordSpelling.word_id)
        .where(UserWordSpelling.user_id == user.id, UserWordSpelling.due_at <= now)
        .order_by(UserWordSpelling.due_at, UserWordSpelling.word_id)
    )
    return [word_id for word_id in rows if word_id not in exclude][: spelling.REVIEWS_PER_SESSION]


def _tile_maker(db: Session, user: User, now: datetime) -> "TileMaker":
    """Letter banks for spelling steps, varied per lesson and step, fixed once planned."""
    headwords: dict[str, str] = {}

    def bank(word_id: str, step_id: str) -> list[str]:
        if word_id not in headwords:
            headwords[word_id] = db.get_one(Word, word_id).headword
        # Seeded for a reproducible layout; tile order is no secret.
        rng = random.Random(f"{user.id}:{now.isoformat()}:{step_id}")  # noqa: S311
        return spelling.tiles(headwords[word_id], rng)

    return bank


def _hard_plan(db: Session, user: User, request: StartHardSession) -> list[PlannedExercise]:
    """The learner's own hardest words of this deck: highest FSRS difficulty, then most lapses."""
    deck = require_published_deck(db, request.deck_id)
    hardest = list(
        db.scalars(
            select(UserWordProgress.word_id)
            .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
            .where(DeckWord.deck_id == deck.id, UserWordProgress.user_id == user.id)
            .order_by(
                UserWordProgress.difficulty.desc().nulls_last(),
                UserWordProgress.lapses.desc(),
                DeckWord.position,
            )
            .limit(HARD_CARDS_PER_SESSION)
        )
    )
    if not hardest:
        raise ApiError(409, "nothing_to_practice", "No words met yet")
    return plan_cards(hardest, [])


def start_session(
    db: Session, user: User, request: StartRequest, now: datetime, time_zone: ZoneInfo
) -> SessionOut:
    """Start a session, or return the learner's unfinished one so it can be resumed."""
    existing = _open_session(db, user)
    if existing is not None:
        return present_session(db, user, existing, now)

    # Practice is never part of the plan, so it records none.
    day_target: int | None = None
    promised_days: int | None = None
    spelling_words: int | None = None
    if isinstance(request, StartStudySession):
        deck_id, plan, day_target, spelling_words = _study_plan(db, user, request, now, time_zone)
        promised_days = user.study_days_per_week
    else:
        deck_id, plan = request.deck_id, _hard_plan(db, user, request)
    session = LearningSession(
        id=uuid4(),
        user_id=user.id,
        deck_id=deck_id,
        kind=request.kind,
        plan=[step.to_json() for step in plan],
        started_at=now,
        day_target=day_target,
        promised_days=promised_days,
        spelling_words=spelling_words,
    )
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        # Another request (double tap, second device) opened a session first: use that one.
        db.rollback()
        existing = _open_session(db, user)
        if existing is None:
            raise
        return present_session(db, user, existing, now)
    return present_session(db, user, session, now)


# --- rating ----------------------------------------------------------------------------------


def _save_schedule(
    db: Session,
    user: User,
    word_id: str,
    before: UserWordProgress | None,
    after: CardState,
    rating: int,
    now: datetime,
) -> None:
    values = {
        "fsrs_state": after.state,
        "fsrs_step": after.step,
        "stability": after.stability,
        "difficulty": after.difficulty,
        "due_at": after.due_at,
        "last_reviewed_at": after.last_reviewed_at,
        "last_seen_at": now,
    }
    if before is None:  # the word's first showing: it is introduced now
        db.execute(
            insert(UserWordProgress).values(
                user_id=user.id,
                word_id=word_id,
                introduced_at=now,
                correct_count=int(rating != AGAIN),
                incorrect_count=int(rating == AGAIN),
                **values,
            )
        )
        return
    lapsed = rating == AGAIN and before.fsrs_state != 1
    before.fsrs_state = after.state
    before.fsrs_step = after.step
    before.stability = after.stability
    before.difficulty = after.difficulty
    before.due_at = after.due_at
    before.last_reviewed_at = after.last_reviewed_at
    before.last_seen_at = now
    before.review_count += 1
    before.lapses += int(lapsed)
    before.correct_count += int(rating != AGAIN)
    before.incorrect_count += int(rating == AGAIN)


def submit_attempt(
    db: Session,
    user: User,
    session_id: UUID,
    attempt: AttemptIn,
    now: datetime,
    time_zone: ZoneInfo,
) -> AttemptResultOut:
    session = _owned_session(db, user, session_id)
    plan = _plan(session)
    position = {step.id: index for index, step in enumerate(plan)}
    if attempt.exercise_id not in position:
        raise ApiError(404, "exercise_not_found", "Exercise not found in this session")
    step = plan[position[attempt.exercise_id]]
    word = db.get_one(Word, step.word_id)

    attempts = _attempts(db, session.id)
    if step.id in attempts:
        # Retry, double tap or second device: the first answer stands.
        return _result_out(attempts[step.id], word.headword)
    if session.completed_at is not None:
        raise ApiError(409, "session_completed", "This session is already complete")
    if position[step.id] != len(attempts):
        raise ApiError(409, "out_of_order", "Answer the exercises in order")
    response = attempt.response
    if step.spelling != isinstance(response, SpellingResponse):
        raise ApiError(422, "wrong_response", "This exercise takes a different kind of answer")

    try:
        if isinstance(response, SpellingResponse):
            stored, inserted = _spell(db, user, session, plan, step, word, response, now, time_zone)
        else:
            stored, inserted = _rate(db, user, session, plan, step, word, response, attempts, now)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _attempts(db, session.id).get(step.id)
        if existing is None:
            raise
        return _result_out(existing, word.headword)
    return _result_out(stored, word.headword, inserted)


def _rate(
    db: Session,
    user: User,
    session: LearningSession,
    plan: list[PlannedExercise],
    step: PlannedExercise,
    word: Word,
    response: RatingResponse,
    attempts: dict[str, ReviewAttempt],
    now: datetime,
) -> tuple[ReviewAttempt, list[InsertedExercise]]:
    rating = response.rating
    progress = _progress(db, user, [step.word_id]).get(step.word_id)
    before = _card_state(progress)
    # Only a card's first showing in a session counts as a review (points, recall rate); the
    # extra showings of a forgotten card are part of relearning it. Spelling does not count.
    repeat = any(
        earlier.word_id == step.word_id and earlier.exercise_type == "card"
        for earlier in attempts.values()
    )
    was_review = before is not None and before.is_review and not repeat
    practice = session.kind == "hard"
    after = before if practice and before else review(before, rating, now)
    assert after is not None
    stored = ReviewAttempt(
        session_id=session.id,
        user_id=user.id,
        word_id=step.word_id,
        exercise_id=step.id,
        exercise_type="card",
        correct=None,
        rating=rating,
        was_review=was_review,
        answered_at=now,
        due_after=after.due_at,
        points=card_points(
            practice=practice, first_showing=step.new and before is None, was_review=was_review
        ),
    )
    db.add(stored)
    # Flush first: if another device rated this showing a moment ago, the unique constraint
    # fails here, before the schedule is touched.
    db.flush()
    inserted: list[InsertedExercise] = []
    if not practice:
        _save_schedule(db, user, step.word_id, progress, after, rating, now)
    # Due again within minutes (learning steps): show it again later in this session. In
    # practice the schedule stands still, so only a forgotten card comes round again.
    soon = (after.due_at - now).total_seconds() <= REQUEUE_WITHIN_SECONDS
    if (rating == AGAIN) if practice else soon:
        requeued = requeue(plan, plan.index(step), step.word_id)
        if requeued:
            new_plan, again = requeued
            session.plan = [planned.to_json() for planned in new_plan]
            db.flush()
            fresh = _progress(db, user, [step.word_id]).get(step.word_id)
            inserted.append(
                InsertedExercise(
                    index=new_plan.index(again), exercise=_card_out(again, word, fresh, now)
                )
            )
    return stored, inserted


def _spell(
    db: Session,
    user: User,
    session: LearningSession,
    plan: list[PlannedExercise],
    step: PlannedExercise,
    word: Word,
    response: SpellingResponse,
    now: datetime,
    time_zone: ZoneInfo,
) -> tuple[ReviewAttempt, list[InsertedExercise]]:
    """Check a built word on the server (the answer is discarded, ADR 0003). A recall counts only
    when right at the first try without seeing the word; it moves the word's spelling schedule
    once per lesson. A miss brings guided practice now and one retry later (ADR 0016)."""
    correct = spelling.is_correct(response.answer, word.headword)
    recall = step.type == "spell_recall"
    hint = recall and response.hint_used
    stored = ReviewAttempt(
        session_id=session.id,
        user_id=user.id,
        word_id=step.word_id,
        exercise_id=step.id,
        exercise_type=step.type,
        correct=correct,
        hint_used=hint,
        answered_at=now,
        points=0,  # spelling never earns points or a place on the board
    )
    db.add(stored)
    db.flush()
    inserted: list[InsertedExercise] = []
    if not recall:
        return stored, inserted
    recalled = correct and not hint
    if not step.retry:  # the word's first recall in this lesson
        _save_spelling(db, user, step.word_id, recalled, local_date(now, time_zone), time_zone, now)
    if not recalled:
        new_plan, added = after_miss(
            plan, plan.index(step), step, _tile_maker(db, user, now), spelling.RECALL_GAP
        )
        session.plan = [planned.to_json() for planned in new_plan]
        db.flush()
        inserted = [
            InsertedExercise(index=index, exercise=_exercise_out(extra, word, None, now))
            for index, extra in added
        ]
    return stored, inserted


def _save_spelling(
    db: Session,
    user: User,
    word_id: str,
    recalled: bool,
    today: date,
    time_zone: ZoneInfo,
    now: datetime,
) -> None:
    row = db.get(UserWordSpelling, (user.id, word_id))
    stage, due_at = spelling.next_review(row.stage if row else 0, recalled, today, time_zone)
    if row is None:
        db.add(
            UserWordSpelling(
                user_id=user.id, word_id=word_id, stage=stage, due_at=due_at, updated_at=now
            )
        )
    else:
        row.stage, row.due_at, row.updated_at = stage, due_at, now


# --- completing ------------------------------------------------------------------------------


def complete_session(
    db: Session, user: User, session_id: UUID, now: datetime, time_zone: ZoneInfo
) -> SummaryOut:
    session = _owned_session(db, user, session_id)
    plan = _plan(session)
    attempts = _attempts(db, session.id)
    if len(attempts) < len(plan):
        raise ApiError(409, "session_incomplete", "Some cards have not been rated")
    if session.completed_at is None:
        session.completed_at = now
        db.commit()

    cards = [step for step in plan if not step.spelling]
    word_ids = list(dict.fromkeys(step.word_id for step in cards))
    words = _words_by_id(db, word_ids)
    progress = _progress(db, user, word_ids)
    rated = [attempts[step.id] for step in cards]
    last_rating = {attempt.word_id: attempt.rating or 0 for attempt in rated}
    lowest = {word_id: 4 for word_id in word_ids}
    for attempt in rated:
        lowest[attempt.word_id] = min(lowest[attempt.word_id], attempt.rating or 4)
    showings = {word_id: 0 for word_id in word_ids}
    for attempt in rated:
        showings[attempt.word_id] += 1
    counts = [sum(1 for attempt in rated if attempt.rating == r) for r in (1, 2, 3, 4)]
    return SummaryOut(
        session_id=session.id,
        kind=session.kind,
        deck_id=session.deck_id,
        words=[
            SummaryWord(
                word=_word_out(words[i]),
                rating=last_rating[i],
                lowest_rating=lowest[i],
                showings=showings[i],
                next_review_at=progress[i].due_at,
            )
            for i in word_ids
        ],
        new_words=sum(1 for step in cards if step.new),
        reviewed_words=len({attempt.word_id for attempt in rated if attempt.was_review}),
        ratings=RatingCounts(again=counts[0], hard=counts[1], good=counts[2], easy=counts[3]),
        today=today_plan(db, user, now, time_zone),
        spelling=_spelling_summary(plan, attempts),
    )


def _spelling_summary(
    plan: list[PlannedExercise], attempts: dict[str, ReviewAttempt]
) -> SpellingSummaryOut | None:
    """Each word's first recall in the lesson decides: right without seeing the word, or not."""
    first: dict[str, ReviewAttempt] = {}
    for step in plan:
        if step.type == "spell_recall" and not step.retry:
            first.setdefault(step.word_id, attempts[step.id])
    if not first:
        return None
    right = sum(1 for attempt in first.values() if attempt.correct and not attempt.hint_used)
    return SpellingSummaryOut(words=len(first), first_try=right, needs_practice=len(first) - right)


# --- account ---------------------------------------------------------------------------------


def delete_learner(db: Session, user: User) -> None:
    """Foreign keys cascade from users to sessions, attempts, progress and group memberships (one
    transaction); groups the learner owned pass to the next member first, empty ones go."""
    groups.leave_all(db, user)
    db.delete(user)
    db.commit()
