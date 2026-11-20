"""The coach's rules (ADR 0071), without a database: goal feasibility, the weekly breakdown, study
times, what to do now, and the weekly adjustment."""

import itertools
from datetime import date

import pytest

from app.services.coach.adapt import Proposal, Week, review
from app.services.coach.breakdown import Target, most_behind, weekly_targets, with_progress
from app.services.coach.goal import Goal, feasibility, level_of
from app.services.coach.now import what_now
from app.services.coach.windows import Block, free_on, propose

TODAY = date(2026, 11, 20)
WEEKDAYS = 0b0011111  # Mon–Fri


# --- goal -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "target", "level"),
    [
        ("ielts", "6.5", "B2"),
        ("ielts", "7", "C1"),
        ("ielts", "5,5", "B2"),
        ("ielts", "4.5", "B1"),
        ("general", "b2", "B2"),
        ("travel", None, None),
        ("ielts", "band six", None),
    ],
)
def test_targets_are_read_as_levels(kind: str, target: str | None, level: str | None) -> None:
    assert level_of(kind, target) == level  # type: ignore[arg-type]


def test_a_far_goal_on_little_time_is_said_to_be_out_of_reach_with_what_would_work() -> None:
    goal = Goal("ielts", "6.5", deadline=date(2027, 6, 1), start_level="A2")
    seen = feasibility(goal, minutes_a_day=20, days_a_week=5, today=TODAY)
    assert seen.status == "not_possible"
    assert seen.hours_needed == 550 - 190
    assert seen.weekly_minutes == 100
    # What it would take, per promised day, and when it would be reached at this pace.
    assert seen.minutes_a_day_needed is not None and seen.minutes_a_day_needed > 100
    assert seen.reached_by is not None and seen.reached_by > goal.deadline  # type: ignore[operator]


def test_enough_time_is_on_track_and_nearly_enough_is_tight() -> None:
    goal = Goal("general", "B1", deadline=date(2027, 11, 20), start_level="A2")
    # 185 hours over 52 weeks: about 213 minutes a week.
    assert feasibility(goal, 45, 5, TODAY).status == "on_track"
    assert feasibility(goal, 32, 5, TODAY).status == "tight"
    assert feasibility(goal, 15, 5, TODAY).status == "not_possible"


def test_no_target_or_no_deadline_is_open_and_a_reached_level_says_so() -> None:
    assert feasibility(Goal("travel"), 15, 5, TODAY).status == "open"
    open_date = feasibility(Goal("general", "B1", start_level="A2"), 30, 5, TODAY)
    assert open_date.status == "open" and open_date.reached_by is not None
    assert feasibility(Goal("general", "B1", start_level="B2"), 30, 5, TODAY).status == "reached"


# --- breakdown ------------------------------------------------------------------------------


def test_the_week_splits_by_the_goal_and_in_things_to_do() -> None:
    week = {t.skill: t for t in weekly_targets("ielts", 100)}
    assert set(week) == {"words", "reading", "writing", "speaking"}
    assert sum(t.minutes for t in week.values()) == 100
    assert week["words"].planned == round(25 / 1.2)
    assert week["writing"].planned == 2  # 25 minutes: two essays
    # Travel never asks for essays.
    assert "writing" not in {t.skill for t in weekly_targets("travel", 100)}


def test_a_small_week_still_gets_one_of_each_skill_it_can_fit() -> None:
    week = {t.skill: t.planned for t in weekly_targets("ielts", 40)}
    assert week["writing"] == 1  # 10 minutes: at least half an essay's time


def test_the_skill_most_behind_this_point_of_the_week_comes_first() -> None:
    targets = with_progress(
        [Target("words", 50, 40), Target("reading", 30, 4), Target("speaking", 20, 4)],
        {"words": 30, "reading": 0, "speaking": 2},
    )
    assert most_behind(targets, week_share=0.6) == ["reading", "speaking"]
    # Words are ahead of the week, so they are not pushed.
    assert "words" not in most_behind(targets, 0.6)


# --- study times ----------------------------------------------------------------------------

SCHOOL = Block(WEEKDAYS, 8 * 60, 14 * 60)
GYM = Block(0b0001010, 18 * 60, 19 * 60)  # Tue, Thu


def test_study_times_are_free_on_every_chosen_day_and_apart() -> None:
    options = propose([SCHOOL, GYM], WEEKDAYS, 20)
    assert 2 <= len(options) <= 3
    for option in options:
        for day in range(5):
            assert free_on([SCHOOL, GYM], day, option.start, option.start + 20)
    starts = sorted(o.start for o in options)
    assert all(b - a >= 120 for a, b in itertools.pairwise(starts))


def test_where_the_learner_already_studies_wins_and_says_why() -> None:
    habit = [19 * 60 + 25, 19 * 60 + 40, 19 * 60 + 30, 19 * 60 + 35]
    best = propose([SCHOOL, GYM], WEEKDAYS, 20, habit=habit)[0]
    assert abs(best.start - (19 * 60 + 30)) <= 45 and "habit" in best.reasons


def test_a_preferred_part_of_the_day_and_right_after_school_count() -> None:
    morning = propose([SCHOOL], WEEKDAYS, 15, preference="morning")[0]
    assert morning.start < 8 * 60 and "preferred" in morning.reasons
    after = propose([SCHOOL], WEEKDAYS, 20, preference="day")[0]
    assert 14 * 60 <= after.start <= 15 * 60 and "after_block" in after.reasons


def test_a_full_day_offers_nothing() -> None:
    busy = Block(0b1111111, 6 * 60, 23 * 60)
    assert propose([busy], WEEKDAYS, 20) == []


# --- now ------------------------------------------------------------------------------------

TASKS = [{"kind": "vocab", "deckId": "a1", "minutes": 8}, {"kind": "reading", "minutes": 6}]
TITLED = [("Школа", SCHOOL), ("Спорт", GYM)]


def test_free_now_means_the_first_task_until_the_next_block() -> None:
    now = what_now(TASKS, TITLED, weekday=1, minute=15 * 60)  # Tuesday 15:00
    assert now.state == "do" and now.task == TASKS[0] and now.until == 18 * 60


def test_busy_now_says_with_what_and_until_when() -> None:
    now = what_now(TASKS, TITLED, weekday=0, minute=10 * 60)
    assert (now.state, now.busy_with, now.until) == ("busy", "Школа", 14 * 60)


def test_nothing_left_is_done_and_the_study_time_is_known() -> None:
    now = what_now([], TITLED, weekday=2, minute=19 * 60, study_start=19 * 60, study_minutes=20)
    assert now.state == "done" and now.in_study_time


# --- the weekly adjustment ------------------------------------------------------------------


def week(**changes: object) -> Week:
    base: dict[str, object] = {
        "promised": 5,
        "kept": 5,
        "starts": [19 * 60] * 5,
        "minutes_studied": [20] * 5,
        "commit_start": 19 * 60,
        "commit_minutes": 20,
        "commit_days": 5,
    }
    return Week(**(base | changes))  # type: ignore[arg-type]


def test_a_plan_kept_as_promised_is_left_alone() -> None:
    assert review(week()) is None


def test_a_plan_mostly_missed_gets_easier_first_by_minutes_then_by_days() -> None:
    assert review(week(kept=2, starts=[19 * 60] * 2)) == Proposal("easier_minutes", minutes=15)
    assert review(week(kept=1, commit_minutes=10, starts=[19 * 60])) == Proposal(
        "fewer_days", days=4
    )


def test_studying_at_another_time_moves_the_time_there() -> None:
    late = [21 * 60 + 5, 21 * 60 + 20, 20 * 60 + 55, 21 * 60 + 10]
    assert review(week(kept=4, starts=late)) == Proposal("move_time", start=21 * 60)


def test_a_plan_kept_with_room_to_spare_grows_a_little() -> None:
    assert review(week(minutes_studied=[28, 30, 25, 26, 31])) == Proposal(
        "more_minutes", minutes=25
    )


def test_a_kept_plan_short_of_the_deadline_says_so() -> None:
    assert review(week(goal="not_possible")) == Proposal("behind")
