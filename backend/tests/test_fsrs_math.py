"""The scheduler checked against FSRS-6 as published, not against itself.

`spec` below is an independent transcription of the FSRS-6 equations (open-spaced-repetition
wiki, «The Algorithm»; the Rust reference used by Anki) with the 21 default parameters. Thousands
of random review histories go through both it and `app.services.scheduling.review`; every
stability, difficulty and due time must agree. Then the properties any correct memory model
must have: R(S, S) = 90%, the interval at 90% retention is S, success never lowers stability,
forgetting always does, ratings are ordered, harder cards grow slower, the spacing effect, and a
calibration check: a simulated learner whose memory follows the model recalls about 90% of
scheduled reviews.
"""

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest

from app.services.scheduling import LEARNING, RELEARNING, REVIEW, CardState, previews, review

W = (
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
)  # fmt: skip
DECAY = W[20]
FACTOR = 0.9 ** (-1 / DECAY) - 1
RETENTION = 0.9
LEARNING_STEPS = (timedelta(minutes=1), timedelta(minutes=10))
RELEARNING_STEP = timedelta(minutes=10)
START = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


# --- the published equations ------------------------------------------------------------------


def retrievability(t: float, s: float) -> float:
    """R(t, S) = (1 + factor · t / S)^(−w20), factor chosen so that R(S, S) = 0.9."""
    return (1 + FACTOR * t / s) ** -DECAY


def interval(s: float, r: float = RETENTION) -> float:
    """The inverse: I(r, S) = S / factor · (r^(−1/w20) − 1)."""
    return s / FACTOR * (r ** (-1 / DECAY) - 1)


def s0(g: int) -> float:
    return W[g - 1]


def d0(g: int) -> float:
    return W[4] - math.exp(W[5] * (g - 1)) + 1


def next_d(d: float, g: int) -> float:
    damped = d + (-W[6] * (g - 3)) * (10 - d) / 9  # linear damping
    return min(10.0, max(1.0, W[7] * d0(4) + (1 - W[7]) * damped))  # mean reversion to D0(Easy)


def s_recall(d: float, s: float, r: float, g: int) -> float:
    hard = W[15] if g == 2 else 1.0
    easy = W[16] if g == 4 else 1.0
    return s * (
        1 + math.exp(W[8]) * (11 - d) * s ** -W[9] * (math.exp(W[10] * (1 - r)) - 1) * hard * easy
    )


def s_forget(d: float, s: float, r: float) -> float:
    long_term = W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * math.exp(W[14] * (1 - r))
    return min(long_term, s / math.exp(W[17] * W[18]))


def s_short(s: float, g: int) -> float:
    """Same-day review: S · e^(w17·(G − 3 + w18)) · S^(−w19), never shrinking when recalled."""
    increase = math.exp(W[17] * (g - 3 + W[18])) * s ** -W[19]
    return s * (max(increase, 1.0) if g >= 2 else increase)


@dataclass
class Spec:
    """A card under the published rules, with Anki's default steps (1 m, 10 m; relearn 10 m)."""

    state: int = LEARNING
    step: int | None = 0
    s: float | None = None
    d: float | None = None
    last: datetime | None = None
    due: datetime = START

    def rate(self, g: int, now: datetime) -> None:
        elapsed = (now - self.last).days if self.last else None  # whole 24-hour periods
        if self.s is None or self.d is None:
            self.s, self.d = s0(g), min(10.0, max(1.0, d0(g)))
        elif elapsed is not None and elapsed < 1:
            self.s, self.d = s_short(self.s, g), next_d(self.d, g)
        else:
            r = retrievability(elapsed or 0, self.s)
            self.s = s_recall(self.d, self.s, r, g) if g > 1 else s_forget(self.d, self.s, r)
            self.d = next_d(self.d, g)
        self.s = max(self.s, 0.001)
        self.last = now
        days = timedelta(days=min(max(round(interval(self.s)), 1), 36500))
        if self.state == LEARNING:
            assert self.step is not None
            if g == 1:
                self.step, self.due = 0, now + LEARNING_STEPS[0]
            elif g == 2:
                wait = (
                    (LEARNING_STEPS[0] + LEARNING_STEPS[1]) / 2
                    if self.step == 0
                    else LEARNING_STEPS[self.step]
                )
                self.due = now + wait
            elif g == 3 and self.step + 1 < len(LEARNING_STEPS):
                self.step += 1
                self.due = now + LEARNING_STEPS[self.step]
            else:
                self.state, self.step, self.due = REVIEW, None, now + days
        elif self.state == REVIEW:
            if g == 1:
                self.state, self.step, self.due = RELEARNING, 0, now + RELEARNING_STEP
            else:
                self.due = now + days
        else:  # relearning: one step; Again repeats it, Hard waits 1.5 steps, Good/Easy graduate
            if g == 1:
                self.due = now + RELEARNING_STEP
            elif g == 2:
                self.due = now + RELEARNING_STEP * 1.5
            else:
                self.state, self.step, self.due = REVIEW, None, now + days


def ours(card: CardState | None, g: int, now: datetime) -> CardState:
    return review(card, g, now)


# --- 1. our scheduler computes exactly the published FSRS-6 ------------------------------------


def test_thousands_of_random_histories_match_the_published_equations() -> None:
    rng = random.Random(20261030)
    gaps = [timedelta(minutes=1), timedelta(minutes=10), timedelta(hours=5), timedelta(hours=30)]
    compared = 0
    for _ in range(2000):
        spec, card, now = Spec(), None, START
        for _ in range(rng.randint(1, 25)):
            g = rng.choices((1, 2, 3, 4), weights=(2, 2, 6, 1))[0]
            spec.rate(g, now)
            card = ours(card, g, now)
            assert (card.state, card.step) == (spec.state, spec.step)
            assert card.stability == pytest.approx(spec.s, rel=1e-9)
            assert card.difficulty == pytest.approx(spec.d, rel=1e-9)
            assert card.due_at == spec.due
            compared += 1
            # Next answer: on time, early, late, or within the same session.
            due_in = card.due_at - now
            now += rng.choice([due_in, due_in * 0.5, due_in * 2.5, rng.choice(gaps)])
    assert compared > 20_000


# --- 2. properties of the model --------------------------------------------------------------


def test_stability_is_the_time_for_recall_to_fall_to_90_percent() -> None:
    for s in (0.5, 1, 2.3, 10, 100, 1000):
        assert retrievability(s, s) == pytest.approx(0.9, abs=1e-12)
        assert interval(s) == pytest.approx(s, rel=1e-12)  # 90% retention: review after S days
        assert retrievability(0, s) == 1
        # Forgetting only goes one way, and slower than an exponential at long delays.
        curve = [retrievability(t, s) for t in range(0, 400, 7)]
        assert curve == sorted(curve, reverse=True)
        assert retrievability(10 * s, s) > 0.9**10


def test_the_scheduled_interval_is_stability_rounded_to_whole_days() -> None:
    card = ours(None, 4, START)  # Easy: straight to review with S0(Easy) = 8.2956 days
    assert card.stability == pytest.approx(W[3])
    assert card.due_at - START == timedelta(days=8)


def review_card(s: float, d: float, last_days_ago: int) -> CardState:
    return CardState(
        state=REVIEW,
        step=None,
        stability=s,
        difficulty=d,
        due_at=START,
        last_reviewed_at=START - timedelta(days=last_days_ago),
    )


@pytest.mark.parametrize("s,d,ago", [(1, 1, 1), (5, 5, 5), (20, 8, 30), (120, 3, 100), (3, 10, 20)])
def test_success_never_lowers_stability_and_forgetting_always_does(
    s: float, d: float, ago: int
) -> None:
    card = review_card(s, d, ago)
    after = {g: ours(card, g, START) for g in (1, 2, 3, 4)}
    assert after[1].stability is not None and after[1].stability < s
    for g in (2, 3, 4):
        assert (after[g].stability or 0) >= s
    # Ratings are ordered: Again < Hard < Good < Easy for stability, the reverse for difficulty.
    stabilities = [after[g].stability or 0 for g in (1, 2, 3, 4)]
    difficulties = [after[g].difficulty or 0 for g in (1, 2, 3, 4)]
    assert stabilities == sorted(stabilities) and len(set(stabilities)) == 4
    assert difficulties == sorted(difficulties, reverse=True)
    assert all(1 <= value <= 10 for value in difficulties)


def test_harder_words_gain_less_stability_from_the_same_success() -> None:
    gains = [(ours(review_card(10, d, 10), 3, START).stability or 0) for d in (1, 3, 5, 7, 9, 10)]
    assert gains == sorted(gains, reverse=True)


def test_the_spacing_effect_a_later_successful_review_strengthens_memory_more() -> None:
    gains = [(ours(review_card(10, 5, ago), 3, START).stability or 0) for ago in (1, 5, 10, 20, 40)]
    assert gains == sorted(gains)


def test_anki_learning_steps_one_and_ten_minutes_relearning_ten() -> None:
    first = ours(None, 3, START)
    assert (first.state, first.due_at - START) == (LEARNING, timedelta(minutes=10))
    assert ours(None, 1, START).due_at - START == timedelta(minutes=1)
    assert ours(None, 2, START).due_at - START == timedelta(minutes=5, seconds=30)  # (1 + 10) / 2
    graduated = ours(first, 3, START + timedelta(minutes=10))
    assert graduated.state == REVIEW
    lapse = ours(review_card(10, 5, 10), 1, START)
    assert (lapse.state, lapse.due_at - START) == (RELEARNING, timedelta(minutes=10))


# --- 3. calibration ----------------------------------------------------------------------------


def test_a_learner_whose_memory_follows_the_model_recalls_about_90_percent_of_reviews() -> None:
    """Monte Carlo: the true recall probability at each scheduled review is R(elapsed, S). If the
    intervals are right, about 90% of reviews succeed (a little more for short intervals, which
    are rounded up to a whole day)."""
    rng = random.Random(7)
    recalled = reviews = 0
    for _ in range(3000):
        card = ours(ours(None, 3, START), 3, START + timedelta(minutes=10))
        now = START + timedelta(minutes=10)
        for _ in range(8):
            assert card.last_reviewed_at is not None and card.stability is not None
            now = card.due_at
            elapsed = (now - card.last_reviewed_at).days
            remembered = rng.random() < retrievability(elapsed, card.stability)
            recalled += remembered
            reviews += 1
            card = ours(card, 3 if remembered else 1, now)
            if not remembered:  # relearn ten minutes later, then back to review
                now = card.due_at
                card = ours(card, 3, now)
    assert 0.88 <= recalled / reviews <= 0.93


# --- 4. where the library and Anki differ ------------------------------------------------------


def test_previews_can_show_good_and_easy_on_the_same_day_count() -> None:
    """Anki forces Hard < Good < Easy for review cards (`.max(hard + 1)`); the library doesn't.
    Search the space for a review card whose Good and Hard intervals coincide."""
    clashes = []
    for s in (0.3, 0.6, 1, 1.5, 2, 3):
        for d in (1, 5, 9, 10):
            shown = previews(review_card(s, d, 1), START)
            days = [round(shown[g] / timedelta(days=1)) for g in (2, 3, 4)]
            if len(set(days)) < 3:
                clashes.append((s, d, days))
    assert clashes, "no clash found: the ordering holds for these cards"
