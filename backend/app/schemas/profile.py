"""A learner's week, for the profile window (ADR 0015). Nicknames only: no e-mail, no user id."""

from datetime import date

from pydantic import BaseModel


class ExtraOut(BaseModel):
    """Learning beyond the promised plan: recognised here, never on the board."""

    # New words beyond each day's target this week.
    new_words: int
    # Answers in practice sessions («Трудные слова») this week.
    practice_answers: int


class ProfileOut(BaseModel):
    # The member's nickname in the group the profile was opened from; null for one's own profile.
    nickname: str | None
    is_me: bool
    week_start: date
    week_end: date
    # The promise: new words a day and days a week.
    words_per_day: int
    promised_days: int
    # Days this week with the plan done, and which ones (Monday … Sunday).
    plan_days: int
    week: list[bool]
    # Today's position in `week` (0 = Monday).
    today_index: int
    # New words met this week within the plan.
    planned_words: int
    # Weeks in a row with the promise kept.
    streak_weeks: int
    # Words met in the whole course.
    words_total: int
    extra: ExtraOut
