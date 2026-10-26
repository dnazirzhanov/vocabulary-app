"""Learning sessions backed by the database: start, resume, answer, complete.

Every state change happens in one transaction, and uniqueness constraints make retries and
concurrent requests safe (ADR 0003). Learning rules live in services/learning.py and scheduling in
services/scheduling.py. The current time is always passed in, never read here.
"""

from collections.abc import Iterable
from datetime import datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Deck, DeckWord, LearningSession, ReviewAttempt, User, UserWordProgress, Word
from app.schemas.learning import (
    ActiveSessionOut,
    AttemptIn,
    AttemptResultOut,
    ChoiceResponse,
    ChooseMeaningExercise,
    CourseGoalOut,
    DeckOut,
    ExerciseOut,
    IntroduceExercise,
    OptionOut,
    PromptWord,
    RecallMeaningExercise,
    SeenResponse,
    SessionOut,
    StartNewSession,
    StartPracticeSession,
    StartRequest,
    StartReviewSession,
    SummaryOut,
    SummaryWord,
    TextResponse,
    TypePrompt,
    TypeWordExercise,
    WordOut,
)
from app.services import pace
from app.services.learning import (
    CHOICE_TYPES,
    REVIEW_WORDS_PER_SESSION,
    PlannedExercise,
    WordFacts,
    cloze,
    is_last_step_for_word,
    is_typed_answer_correct,
    pick_new_words,
    plan_new_session,
    plan_practice_session,
    plan_review_session,
)
from app.services.progress import (
    DAILY_GOAL_POINTS,
    points_for,
    points_today,
    session_points,
)
from app.services.scheduling import Schedule, after_review, first_schedule

# --- reading ---------------------------------------------------------------------------------


def _facts(word: Word) -> WordFacts:
    return WordFacts(word.id, word.headword, word.pos, word.translation, tuple(word.also_accept))


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


def _exercise_out(step: PlannedExercise, words: dict[str, Word]) -> ExerciseOut:
    word = words[step.word_id]
    if step.type == "introduce":
        return IntroduceExercise(id=step.id, word=_word_out(word))
    if step.type in CHOICE_TYPES:
        model = ChooseMeaningExercise if step.type == "choose_meaning" else RecallMeaningExercise
        return model(
            id=step.id,
            word=PromptWord(headword=word.headword, pos=word.pos, example=word.example),
            options=[OptionOut(id=o, label=words[o].translation) for o in step.options],
        )
    return TypeWordExercise(
        id=step.id,
        prompt=TypePrompt(
            translation=word.translation,
            pos=word.pos,
            cloze=cloze(word.example, word.headword),
            example_ru=word.example_ru,
        ),
    )


def _result_out(step: PlannedExercise, correct: bool | None, word: Word) -> AttemptResultOut:
    return AttemptResultOut(
        exercise_id=step.id,
        correct=correct,
        correct_option_id=step.word_id if step.type in CHOICE_TYPES else None,
        answer=_word_out(word),
    )


def present_session(db: Session, session: LearningSession) -> SessionOut:
    plan = _plan(session)
    words = _words_by_id(db, [s.word_id for s in plan] + [o for s in plan for o in s.options])
    attempts = _attempts(db, session.id)
    return SessionOut(
        id=session.id,
        kind=session.kind,
        deck_id=session.deck_id,
        completed=session.completed_at is not None,
        exercises=[_exercise_out(step, words) for step in plan],
        results=[
            _result_out(step, attempts[step.id].correct, words[step.word_id])
            for step in plan
            if step.id in attempts
        ],
    )


def list_decks(db: Session, user: User, now: datetime) -> list[DeckOut]:
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
    next_due = select(func.min(mine.c.due_at)).where(mine.c.due_at > now).scalar_subquery()
    rows = db.execute(
        select(Deck, word_count, introduced, due, next_due)
        .where(Deck.status == "published")
        .order_by(Deck.id)
    )
    return [
        DeckOut(
            id=deck.id,
            title=deck.title,
            description=deck.description,
            course_goal=CourseGoalOut(
                target_words=deck.goal_words, coverage_percent=deck.goal_coverage_percent
            )
            if deck.goal_words and deck.goal_coverage_percent
            else None,
            word_count=words,
            introduced_count=met,
            due_count=due_now,
            next_due_at=upcoming,
        )
        for deck, words, met, due_now, upcoming in rows
    ]


def active_session(db: Session, user: User) -> ActiveSessionOut:
    session = _open_session(db, user)
    return ActiveSessionOut(session=present_session(db, session) if session else None)


def get_session(db: Session, user: User, session_id: UUID) -> SessionOut:
    return present_session(db, _owned_session(db, user, session_id))


# --- starting --------------------------------------------------------------------------------


def require_published_deck(db: Session, deck_id: str) -> Deck:
    deck = db.get(Deck, deck_id)
    if deck is None or deck.status != "published":
        raise ApiError(404, "deck_not_found", "Deck not found")
    return deck


def _new_session_plan(
    db: Session,
    user: User,
    request: StartNewSession,
    session_id: UUID,
    now: datetime,
    time_zone: ZoneInfo,
) -> tuple[str, list[PlannedExercise]]:
    deck = require_published_deck(db, request.deck_id)
    # Sized by what is left of today's target, or a bonus lesson after it (ADR 0010).
    today = pace.day_plan(db, user, deck.id, now, time_zone)
    if today.blocked_by_reviews:
        raise ApiError(409, "reviews_first", "Too many reviews are due: review before new words")
    pool = _deck_words(db, deck.id)
    introduced = set(
        db.scalars(
            select(UserWordProgress.word_id).where(
                UserWordProgress.user_id == user.id,
                UserWordProgress.word_id.in_([w.id for w in pool]),
            )
        )
    )
    new_ids = pick_new_words([w.id for w in pool], introduced, today.next_lesson_size)
    if not new_ids:
        raise ApiError(409, "deck_complete", "Every word in this deck has been introduced")
    by_id = {w.id: w for w in pool}
    facts = [_facts(w) for w in pool]
    return deck.id, plan_new_session([_facts(by_id[i]) for i in new_ids], facts, str(session_id))


def _practice_session_plan(
    db: Session, user: User, request: StartPracticeSession, session_id: UUID
) -> tuple[str, list[PlannedExercise]]:
    source = _owned_session(db, user, request.source_session_id)
    if source.completed_at is None:
        raise ApiError(409, "session_incomplete", "Finish the session before practising it")
    attempts = _attempts(db, source.id)
    missed: list[str] = []
    for step in _plan(source):
        attempt = attempts.get(step.id)
        if attempt and attempt.correct is False and step.word_id not in missed:
            missed.append(step.word_id)
    if not missed:
        raise ApiError(409, "nothing_to_practice", "That session had no mistakes")
    pool = _deck_words(db, source.deck_id)
    by_id = {w.id: w for w in pool}
    facts = [_facts(w) for w in pool]
    return source.deck_id, plan_practice_session(
        [_facts(by_id[i]) for i in missed], facts, str(session_id)
    )


def _review_session_plan(
    db: Session, user: User, request: StartReviewSession, session_id: UUID, now: datetime
) -> tuple[str, list[PlannedExercise]]:
    deck = require_published_deck(db, request.deck_id)
    due_ids = list(
        db.scalars(
            select(UserWordProgress.word_id)
            .join(DeckWord, DeckWord.word_id == UserWordProgress.word_id)
            .where(
                DeckWord.deck_id == deck.id,
                UserWordProgress.user_id == user.id,
                UserWordProgress.due_at <= now,
            )
            # Most overdue first; deck order breaks ties so plans are reproducible.
            .order_by(UserWordProgress.due_at, DeckWord.position)
            .limit(REVIEW_WORDS_PER_SESSION)
        )
    )
    if not due_ids:
        raise ApiError(409, "nothing_due", "No words are due for review yet")
    pool = _deck_words(db, deck.id)
    by_id = {w.id: w for w in pool}
    facts = [_facts(w) for w in pool]
    return deck.id, plan_review_session([_facts(by_id[i]) for i in due_ids], facts, str(session_id))


def start_session(
    db: Session, user: User, request: StartRequest, now: datetime, time_zone: ZoneInfo
) -> SessionOut:
    """Start a session, or return the learner's unfinished one so it can be resumed."""
    existing = _open_session(db, user)
    if existing is not None:
        return present_session(db, existing)

    session_id = uuid4()
    if isinstance(request, StartNewSession):
        deck_id, plan = _new_session_plan(db, user, request, session_id, now, time_zone)
    elif isinstance(request, StartPracticeSession):
        deck_id, plan = _practice_session_plan(db, user, request, session_id)
    else:
        deck_id, plan = _review_session_plan(db, user, request, session_id, now)

    session = LearningSession(
        id=session_id,
        user_id=user.id,
        deck_id=deck_id,
        kind=request.kind,
        plan=[step.to_json() for step in plan],
        started_at=now,
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
        return present_session(db, existing)
    return present_session(db, session)


# --- answering -------------------------------------------------------------------------------


def _evaluate(step: PlannedExercise, attempt: AttemptIn, word: Word) -> bool | None:
    response = attempt.response
    if step.type == "introduce" and isinstance(response, SeenResponse):
        return None
    if step.type in CHOICE_TYPES and isinstance(response, ChoiceResponse):
        if response.option_id not in step.options:
            raise ApiError(422, "invalid_option", "That option is not part of this exercise")
        return response.option_id == step.word_id
    if step.type == "type_word" and isinstance(response, TextResponse):
        return is_typed_answer_correct(response.text, _facts(word))
    raise ApiError(422, "invalid_response", f"Wrong response kind for a {step.type} exercise")


def _record_progress(
    db: Session, user: User, word_id: str, correct: bool | None, now: datetime
) -> None:
    """Counters on every answer. The row itself, and the first review, are created when the word
    is introduced."""
    first = first_schedule(now)
    stmt = insert(UserWordProgress).values(
        user_id=user.id,
        word_id=word_id,
        introduced_at=now,
        last_seen_at=now,
        correct_count=int(correct is True),
        incorrect_count=int(correct is False),
        stage=first.stage,
        due_at=first.due_at,
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[UserWordProgress.user_id, UserWordProgress.word_id],
            set_={
                "last_seen_at": now,
                "correct_count": UserWordProgress.correct_count + stmt.excluded.correct_count,
                "incorrect_count": UserWordProgress.incorrect_count + stmt.excluded.incorrect_count,
            },
        )
    )


def _review_outcome(
    db: Session,
    user: User,
    session: LearningSession,
    plan: list[PlannedExercise],
    step: PlannedExercise,
    correct: bool | None,
    attempts: dict[str, ReviewAttempt],
    now: datetime,
) -> tuple[Schedule, bool] | None:
    """The new schedule when this attempt finishes a word in a review session; None otherwise.
    New words are scheduled on introduction; practice sessions never touch the schedule."""
    if session.kind != "review" or not is_last_step_for_word(plan, step):
        return None
    earlier = [
        attempts[other.id].correct
        for other in plan
        if other.word_id == step.word_id and other.id in attempts
    ]
    recalled = correct is True and all(earlier)
    stage = db.scalar(
        select(UserWordProgress.stage).where(
            UserWordProgress.user_id == user.id, UserWordProgress.word_id == step.word_id
        )
    )
    assert stage is not None  # a reviewed word was introduced before
    return after_review(stage, recalled, now), recalled


def submit_attempt(
    db: Session, user: User, session_id: UUID, attempt: AttemptIn, now: datetime
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
        return _result_out(step, attempts[step.id].correct, word)
    if session.completed_at is not None:
        raise ApiError(409, "session_completed", "This session is already complete")
    if position[step.id] != len(attempts):
        raise ApiError(409, "out_of_order", "Answer the exercises in order")

    correct = _evaluate(step, attempt, word)
    reviewed = _review_outcome(db, user, session, plan, step, correct, attempts, now)
    if step.type == "introduce":
        schedule: Schedule | None = first_schedule(now)
    else:
        schedule = reviewed[0] if reviewed else None
    try:
        db.add(
            ReviewAttempt(
                session_id=session.id,
                user_id=user.id,
                word_id=step.word_id,
                exercise_id=step.id,
                exercise_type=step.type,
                correct=correct,
                answered_at=now,
                stage_after=schedule.stage if schedule else None,
                due_after=schedule.due_at if schedule else None,
                points=points_for(step.type, reviewed[1] if reviewed else None),
            )
        )
        # Flush first: if another device answered this exercise a moment ago, the unique
        # constraint fails here, before progress is touched.
        db.flush()
        _record_progress(db, user, step.word_id, correct, now)
        if reviewed:
            new_schedule, recalled = reviewed
            db.execute(
                update(UserWordProgress)
                .where(
                    UserWordProgress.user_id == user.id,
                    UserWordProgress.word_id == step.word_id,
                )
                .values(
                    stage=new_schedule.stage,
                    due_at=new_schedule.due_at,
                    last_reviewed_at=now,
                    review_count=UserWordProgress.review_count + 1,
                    lapses=UserWordProgress.lapses + int(not recalled),
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        stored = _attempts(db, session.id).get(step.id)
        if stored is None:
            raise
        return _result_out(step, stored.correct, word)
    return _result_out(step, correct, word)


# --- completing ------------------------------------------------------------------------------


def complete_session(
    db: Session, user: User, session_id: UUID, now: datetime, time_zone: ZoneInfo
) -> SummaryOut:
    session = _owned_session(db, user, session_id)
    plan = _plan(session)
    attempts = _attempts(db, session.id)
    if len(attempts) < len(plan):
        raise ApiError(409, "session_incomplete", "Some exercises have not been answered")
    if session.completed_at is None:
        session.completed_at = now
        db.commit()

    word_ids = list(dict.fromkeys(step.word_id for step in plan))
    words = _words_by_id(db, word_ids)
    answers = [a for a in attempts.values() if a.correct is not None]
    mistakes = {word_id: 0 for word_id in word_ids}
    for answer in answers:
        if answer.correct is False:
            mistakes[answer.word_id] += 1
    # Built explicitly: dict() on a Result would treat it as a mapping because it has .keys().
    next_review = {
        word_id: due_at
        for word_id, due_at in db.execute(
            select(UserWordProgress.word_id, UserWordProgress.due_at).where(
                UserWordProgress.user_id == user.id, UserWordProgress.word_id.in_(word_ids)
            )
        )
    }
    return SummaryOut(
        session_id=session.id,
        kind=session.kind,
        deck_id=session.deck_id,
        words=[
            SummaryWord(
                word=_word_out(words[i]), mistakes=mistakes[i], next_review_at=next_review[i]
            )
            for i in word_ids
        ],
        answers_total=len(answers),
        answers_correct=sum(1 for a in answers if a.correct),
        points=session_points(db, session.id),
        today_points=points_today(db, user, now, time_zone),
        daily_goal=DAILY_GOAL_POINTS,
    )


# --- account ---------------------------------------------------------------------------------


def delete_learner(db: Session, user: User) -> None:
    """Foreign keys cascade from users to sessions, attempts and progress (one transaction)."""
    db.delete(user)
    db.commit()
