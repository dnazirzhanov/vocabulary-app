"""Plan days (ADR 0015): a day counts when the learner's own plan was done; a week against the
days promised; extra words and practice never raise the result."""

from datetime import UTC, date, datetime, timedelta
from fractions import Fraction
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import LearningSession, User
from app.services.plan_days import (
    PlanDay,
    days_by_user,
    promises_by_user,
    week_of,
    week_plan,
    week_streak,
)
from tests.support import Play

MONDAY = date(2026, 11, 2)
DAY0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)  # Monday
STUDY = {"kind": "study", "deck_id": "a1-a2"}
HARD = {"kind": "hard", "deck_id": "a1-a2"}
UTC_ZONE = ZoneInfo("UTC")


def day(
    on: date = MONDAY,
    study: int = 5,
    new: int = 5,
    target: int = 5,
    practice: int = 0,
    completed: bool = True,
    spelled: int | None = None,
) -> PlanDay:
    """A day; its planned words spelled unless `spelled` says otherwise (ADR 0016)."""
    return PlanDay(
        day=on,
        study_answers=study,
        new_words=new,
        practice_answers=practice,
        target=target,
        completed_study=completed,
        spelled=min(new, target) if spelled is None else spelled,
    )


# --- one day ---------------------------------------------------------------------------------


def test_a_day_counts_once_the_target_of_new_words_is_met() -> None:
    assert day(new=5, target=5).plan_done
    assert day(new=12, target=5).plan_done
    assert not day(new=4, target=5).plan_done


def test_the_day_waits_until_its_planned_words_are_spelled() -> None:
    assert not day(new=5, target=5, spelled=0).plan_done
    assert not day(new=5, target=5, spelled=4).plan_done
    assert day(new=12, target=5, spelled=5).plan_done  # the extra words need not be spelled


def test_words_beyond_the_target_are_extra_and_never_planned() -> None:
    assert (day(new=12, target=5).planned_new, day(new=12, target=5).extra_new) == (5, 7)
    assert (day(new=3, target=5).planned_new, day(new=3, target=5).extra_new) == (3, 0)


def test_with_no_new_word_possible_a_finished_study_session_is_the_plan() -> None:
    assert day(new=0, target=0, completed=True).plan_done
    assert not day(new=0, target=0, completed=False).plan_done  # one card, then left


def test_practice_alone_is_not_a_plan_day() -> None:
    assert not day(study=0, new=0, practice=20, target=5).plan_done


# --- one week --------------------------------------------------------------------------------


def test_the_week_counts_plan_days_against_the_promise_and_extra_days_add_nothing() -> None:
    week = week_of(MONDAY)
    every_day = {d: day(on=d) for d in week}
    plan = week_plan(every_day, week, promised=4)
    assert (plan.plan_days, plan.kept, plan.fulfilment, plan.kept_promise) == (
        7,
        4,
        Fraction(1),
        True,
    )
    half = week_plan({week[0]: day(on=week[0]), week[1]: day(on=week[1])}, week, promised=4)
    assert (half.plan_days, half.fulfilment, half.kept_promise) == (2, Fraction(1, 2), False)


def test_two_learners_who_kept_the_same_share_of_their_promise_are_level() -> None:
    week = week_of(MONDAY)
    three_of_six = week_plan({d: day(on=d) for d in week[:3]}, week, promised=6)
    two_of_four = week_plan({d: day(on=d) for d in week[:2]}, week, promised=4)
    assert three_of_six.fulfilment == two_of_four.fulfilment


def test_a_week_of_only_practice_is_active_but_keeps_nothing() -> None:
    week = week_of(MONDAY)
    plan = week_plan({MONDAY: day(study=0, new=0, practice=12)}, week, promised=3)
    assert (plan.active, plan.plan_days, plan.practice_answers) == (True, 0, 12)


def test_the_streak_counts_weeks_kept_and_this_week_never_breaks_it() -> None:
    days: dict[date, PlanDay] = {}
    for weeks_back in (1, 2):  # two full weeks kept, three days each
        start = MONDAY - timedelta(days=7 * weeks_back)
        for n in range(3):
            days[start + timedelta(days=n)] = day(on=start + timedelta(days=n))
    wednesday = MONDAY + timedelta(days=2)
    assert week_streak(days, {}, default=3, today=wednesday) == 2  # this week not kept yet
    for n in range(3):
        days[MONDAY + timedelta(days=n)] = day(on=MONDAY + timedelta(days=n))
    assert week_streak(days, {}, default=3, today=wednesday) == 3
    # A week with fewer days than promised ends it.
    del days[MONDAY - timedelta(days=7)]
    assert week_streak(days, {}, default=3, today=wednesday) == 1


# --- from the database -----------------------------------------------------------------------


def the_user(db: Session) -> User:
    return db.scalars(select(User)).one()


def test_a_lesson_is_a_plan_day_and_a_bonus_lesson_is_extra(
    client: TestClient, db: Session, play: Play
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0)
    play(STUDY, DAY0 + timedelta(hours=1))  # five more: a bonus lesson
    play(HARD, DAY0 + timedelta(hours=2))
    today = days_by_user(db, [the_user(db)], DAY0 - timedelta(days=1), UTC_ZONE)[the_user(db).id]
    monday = today[MONDAY]
    assert (monday.new_words, monday.target, monday.plan_done) == (10, 5, True)
    assert (monday.planned_new, monday.extra_new) == (5, 5)
    assert monday.practice_answers >= 10  # every answer of the practice, repeats included


def test_the_smallest_plan_of_the_day_counts(client: TestClient, db: Session, play: Play) -> None:
    client.patch("/api/me", json={"daily_target_words": 8})
    play(STUDY, DAY0)  # eight words: the plan of 8 done
    client.patch("/api/me", json={"daily_target_words": 20})
    play(STUDY, DAY0 + timedelta(hours=1))  # raising the target later does not undo the day
    days = days_by_user(db, [the_user(db)], DAY0 - timedelta(days=1), UTC_ZONE)
    monday = days[the_user(db).id][MONDAY]
    assert (monday.target, monday.plan_done) == (8, True)


def test_sessions_from_before_plans_were_recorded_use_today_s_settings(
    client: TestClient, db: Session, play: Play
) -> None:
    client.patch("/api/me", json={"daily_target_words": 5})
    play(STUDY, DAY0)
    db.execute(update(LearningSession).values(day_target=None, promised_days=None))
    db.commit()
    client.patch("/api/me", json={"daily_target_words": 3})
    days = days_by_user(db, [the_user(db)], DAY0 - timedelta(days=1), UTC_ZONE)
    assert days[the_user(db).id][MONDAY].target == 3


def test_days_are_local_to_the_learner(client: TestClient, db: Session, play: Play) -> None:
    late = datetime(2026, 11, 2, 20, 0, tzinfo=UTC)  # already Tuesday in Bishkek
    play(STUDY, late, time_zone="Asia/Bishkek")
    user = the_user(db)
    since = late - timedelta(days=2)
    assert set(days_by_user(db, [user], since, ZoneInfo("Asia/Bishkek"))[user.id]) == {
        date(2026, 11, 3)
    }
    db.refresh(user)  # starting the session stored the zone, as boards read it
    assert set(days_by_user(db, [user], since)[user.id]) == {date(2026, 11, 3)}


def test_a_promise_changed_mid_week_applies_from_the_next_week(
    client: TestClient, db: Session, play: Play
) -> None:
    client.patch("/api/me", json={"study_days_per_week": 4})
    play(STUDY, DAY0)
    client.patch("/api/me", json={"study_days_per_week": 1})
    play(STUDY, DAY0 + timedelta(days=2))
    play(STUDY, DAY0 + timedelta(days=7))  # next Monday
    user = the_user(db)
    promises = promises_by_user(db, [user], DAY0 - timedelta(days=1), UTC_ZONE)[user.id]
    assert promises == {MONDAY: 4, MONDAY + timedelta(days=7): 1}
