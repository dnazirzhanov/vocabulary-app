"""The learner's own progress: the Progress page and where spelling stands (ADR 0015, 0027)."""

from dataclasses import asdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Deck, DeckWord, LearningSession, ReviewAttempt, User, UserWordProgress
from app.schemas.learning import (
    DeckProgressOut,
    KnowledgeOut,
    ProgressOut,
    RecallRate,
    SpellingPausedOut,
    SpellingTodayOut,
    StudyDayOut,
    WordStages,
)
from app.services import decks, pace, spelling_ladder
from app.services.progress import RECALL_RATE_DAYS, local_day_bounds, recall_counts
from app.services.scheduling import REVIEW, WELL_LEARNED_STABILITY_DAYS, local_date
from app.services.study_days import (
    HISTORY_DAYS,
    StudyDay,
    days_by_user,
    promises_by_user,
    week_of,
    week_streak,
)


def word_stages(db: Session, user: User, now: datetime) -> WordStages:
    """Words of every published level of the course (a retired deck may still list words that
    moved on). Teachers' own words are not course words: they never count toward its sourced goal
    (ADR 0017)."""
    in_course = (
        select(DeckWord.word_id)
        .join(Deck, Deck.id == DeckWord.deck_id)
        .where(
            DeckWord.word_id == UserWordProgress.word_id,
            Deck.kind == "course",
            Deck.status == "published",
        )
        .exists()
    )
    mine = select(UserWordProgress).where(UserWordProgress.user_id == user.id, in_course).subquery()
    introduced, well_learned, due = db.execute(
        select(
            func.count(),
            func.count().filter(
                (mine.c.fsrs_state == REVIEW) & (mine.c.stability >= WELL_LEARNED_STABILITY_DAYS)
            ),
            func.count().filter(mine.c.due_at <= now),
        ).select_from(mine)
    ).one()
    return WordStages(
        introduced=introduced,
        reviewing=introduced - well_learned,
        well_learned=well_learned,
        due=due,
    )


def _day_out(day: StudyDay) -> StudyDayOut:
    return StudyDayOut(date=day.day, active=True, studied=day.studied, cards=day.answers)


def course_progress(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> ProgressOut:
    today = local_date(now, time_zone)
    since, _ = local_day_bounds(today - timedelta(days=HISTORY_DAYS), time_zone)
    days = days_by_user(db, [user], since, time_zone)[user.id]
    promises = promises_by_user(db, [user], since, time_zone)[user.id]
    monday = week_of(today)[0]
    recalled, reviewed = recall_counts(db, user, now)
    today_out = (
        _day_out(days[today])
        if today in days
        else StudyDayOut(date=today, active=False, studied=False)
    )
    return ProgressOut(
        words=word_stages(db, user, now),
        today=today_out,
        streak_weeks=week_streak(days, promises, user.study_days_per_week, today),
        activity=[_day_out(day) for _, day in sorted(days.items())],
        promised_days=promises.get(monday, user.study_days_per_week),
        recall=RecallRate(recalled=recalled, reviewed=reviewed, days=RECALL_RATE_DAYS),
        spelling_today=spelling_today(db, user, now, time_zone),
    )


def spelling_today(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> SpellingTodayOut:
    """Where the learner's spelling stands (ADR 0026): the main button's words, today's words
    still to spell, and the ladder's hard and known words."""
    seen = spelling_ladder.overview(spelling_ladder.load(db, user, now, time_zone), now)
    return SpellingTodayOut(**asdict(seen), paused=_paused_spelling(db, user))


def _paused_spelling(db: Session, user: User) -> SpellingPausedOut | None:
    """An unfinished spelling session: how far it got (ADR 0026)."""
    session = db.scalar(
        select(LearningSession).where(
            LearningSession.user_id == user.id,
            LearningSession.kind == "spelling",
            LearningSession.completed_at.is_(None),
        )
    )
    if session is None:
        return None
    spelled, right = db.execute(
        select(func.count(), func.count().filter(ReviewAttempt.correct.is_(True))).where(
            ReviewAttempt.session_id == session.id
        )
    ).one()
    return SpellingPausedOut(spelled=spelled, right=right, total=len(session.plan))


def knowledge(db: Session, user: User, now: datetime, time_zone: ZoneInfo) -> KnowledgeOut:
    """What I know, deck by deck (ADR 0022): my own decks, my groups' decks and the course levels
    I've started. «Learned» is evidence of memory, not exposure: a word recalled in a later review
    (reviews come a day or more after meeting it) with any answer but «Снова»."""
    given = {item.deck.id: item for item in decks.assigned_decks(db, user)}
    candidates = list(
        db.scalars(
            select(Deck)
            .where(
                or_(
                    (Deck.kind == "course") & (Deck.status == "published"),
                    Deck.owner_id == user.id,
                    Deck.id.in_(list(given)),
                )
            )
            .order_by(Deck.level_order, Deck.id)
        )
    )
    ids = [deck.id for deck in candidates]
    sizes = dict(
        db.execute(
            select(DeckWord.deck_id, func.count())
            .where(DeckWord.deck_id.in_(ids))
            .group_by(DeckWord.deck_id)
        ).all()
    )
    recalled = (
        select(ReviewAttempt.word_id)
        .where(
            ReviewAttempt.user_id == user.id,
            ReviewAttempt.was_review.is_(True),
            ReviewAttempt.rating >= 2,
        )
        .distinct()
    )
    well = (UserWordProgress.fsrs_state == REVIEW) & (
        UserWordProgress.stability >= WELL_LEARNED_STABILITY_DAYS
    )
    mine = (
        select(DeckWord.deck_id, UserWordProgress.word_id, UserWordProgress.last_seen_at)
        .join(
            UserWordProgress,
            (UserWordProgress.word_id == DeckWord.word_id) & (UserWordProgress.user_id == user.id),
        )
        .where(DeckWord.deck_id.in_(ids))
    )
    counts = {
        deck_id: (int(met), int(learned), int(known), last)
        for deck_id, met, learned, known, last in db.execute(
            select(
                DeckWord.deck_id,
                func.count(),
                func.count().filter(UserWordProgress.word_id.in_(recalled)),
                func.count().filter(well),
                func.max(UserWordProgress.last_seen_at),
            )
            .join(
                UserWordProgress,
                (UserWordProgress.word_id == DeckWord.word_id)
                & (UserWordProgress.user_id == user.id),
            )
            .where(DeckWord.deck_id.in_(ids))
            .group_by(DeckWord.deck_id)
        )
    }
    # The level the learner is on: the first with words still to meet. Levels share the course's
    # pace, so only this one carries today's goal (ADR 0033); a later one is locked until then.
    current_level = next(
        (
            deck.id
            for deck in candidates
            if deck.kind == "course" and counts.get(deck.id, (0,))[0] < int(sizes.get(deck.id, 0))
        ),
        None,
    )
    rows: list[DeckProgressOut] = []
    for deck in candidates:
        met, learned, known, last = counts.get(deck.id, (0, 0, 0, None))
        size = int(sizes.get(deck.id, 0))
        # A course level appears once started; my decks and my groups' always, unless empty.
        if size == 0 or (deck.kind == "course" and met == 0):
            continue
        item = given.get(deck.id)
        # Today in this deck (ADR 0028): shown, never judged.
        today = pace.day_plan(db, user, deck.id, now, time_zone)
        shares_pace = deck.kind != "course" or deck.id == current_level
        rows.append(
            DeckProgressOut(
                id=deck.id,
                title=deck.title,
                kind="course" if deck.kind == "course" else "user",
                level=deck.level,
                is_mine=deck.owner_id == user.id,
                author=item.author if item else None,
                group_name=item.group_name if item else None,
                word_count=size,
                met=met,
                learned=learned,
                known=known,
                last_studied_at=last,
                new_today=today.new_today if shares_pace else 0,
                goal_today=min(today.effective_target, today.new_today + size - met)
                if shares_pace
                else 0,
                due_on=item.due_on if item else None,
                pace=today.target if shares_pace else 0,
            )
        )
    rows.sort(
        key=lambda row: (row.last_studied_at is None, -(row.last_studied_at or now).timestamp())
    )
    shown = [row.id for row in rows]
    words = mine.where(DeckWord.deck_id.in_(shown)).subquery()
    met, learned, known = db.execute(
        select(
            func.count(func.distinct(words.c.word_id)),
            func.count(func.distinct(words.c.word_id)).filter(words.c.word_id.in_(recalled)),
            func.count(func.distinct(UserWordProgress.word_id)).filter(well),
        )
        .select_from(words)
        .join(
            UserWordProgress,
            (UserWordProgress.word_id == words.c.word_id) & (UserWordProgress.user_id == user.id),
        )
    ).one()
    return KnowledgeOut(decks=rows, met=int(met), learned=int(learned), known=int(known))
