/**
 * FSRS-6, as the `fsrs` Python package 6.3.2 computes it (backend/uv.lock), with the app's
 * settings: retention 0.9, no fuzz, learning steps of 1 and 10 minutes, relearning of 10
 * (backend/app/services/scheduling.py). Only `review_card` and what it calls; the server stays the
 * authority, and web/src/study/vectors.json (made from the Python code) keeps the two equal.
 *
 * Python's rounding is kept on purpose: `round()` sends halves to the even number, and
 * `timedelta.days` rounds down.
 */

export const LEARNING = 1;
export const REVIEW = 2;
export const RELEARNING = 3;
export type Rating = 1 | 2 | 3 | 4;

const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const DESIRED_RETENTION = 0.9;
const DECAY = -W[20];
const FACTOR = 0.9 ** (1 / DECAY) - 1;
const MAXIMUM_INTERVAL = 36500;
const MINUTE = 60_000;
const DAY = 86_400_000;
const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
const RELEARNING_STEPS = [10 * MINUTE];
const STABILITY_MIN = 0.001;

/** A card as the library holds it; moments in milliseconds. */
export interface FsrsCard {
  state: number;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  due: number;
  lastReview: number | null;
}

/** Python's round(): halves go to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const clampDifficulty = (difficulty: number) => Math.min(Math.max(difficulty, 1), 10);
const clampStability = (stability: number) => Math.max(stability, STABILITY_MIN);

const initialStability = (rating: Rating) => clampStability(W[rating - 1]);

function initialDifficulty(rating: Rating, clamp: boolean): number {
  const difficulty = W[4] - Math.E ** (W[5] * (rating - 1)) + 1;
  return clamp ? clampDifficulty(difficulty) : difficulty;
}

export function nextInterval(stability: number): number {
  const interval = roundHalfEven((stability / FACTOR) * (DESIRED_RETENTION ** (1 / DECAY) - 1));
  return Math.min(Math.max(interval, 1), MAXIMUM_INTERVAL);
}

function shortTermStability(stability: number, rating: Rating): number {
  let increase = Math.E ** (W[17] * (rating - 3 + W[18])) * stability ** -W[19];
  if (rating >= 2) increase = Math.max(increase, 1.0);
  return clampStability(stability * increase);
}

function nextDifficulty(difficulty: number, rating: Rating): number {
  const delta = -(W[6] * (rating - 3));
  const damped = difficulty + ((10.0 - difficulty) * delta) / 9.0;
  return clampDifficulty(W[7] * initialDifficulty(4, false) + (1 - W[7]) * damped);
}

function retrievability(card: FsrsCard, now: number): number {
  if (card.lastReview === null || card.stability === null) return 0;
  const elapsedDays = Math.max(0, Math.floor((now - card.lastReview) / DAY));
  return (1 + (FACTOR * elapsedDays) / card.stability) ** DECAY;
}

function nextStability(difficulty: number, stability: number, recall: number, rating: Rating): number {
  let next: number;
  if (rating === 1) {
    const longTerm = W[11] * difficulty ** -W[12] * ((stability + 1) ** W[13] - 1) * Math.E ** ((1 - recall) * W[14]);
    const shortTerm = stability / Math.E ** (W[17] * W[18]);
    next = Math.min(longTerm, shortTerm);
  } else {
    const hardPenalty = rating === 2 ? W[15] : 1;
    const easyBonus = rating === 4 ? W[16] : 1;
    next =
      stability *
      (1 +
        Math.E ** W[8] *
          (11 - difficulty) *
          stability ** -W[9] *
          (Math.E ** ((1 - recall) * W[10]) - 1) *
          hardPenalty *
          easyBonus);
  }
  return clampStability(next);
}

/** Steps through learning or relearning (the two share their rules, with their own steps). */
function stepped(card: FsrsCard, rating: Rating, steps: number[]): number {
  if (steps.length === 0 || (card.step! >= steps.length && rating >= 2)) {
    card.state = REVIEW;
    card.step = null;
    return nextInterval(card.stability!) * DAY;
  }
  switch (rating) {
    case 1:
      card.step = 0;
      return steps[0];
    case 2:
      if (card.step === 0 && steps.length === 1) return steps[0] * 1.5;
      if (card.step === 0 && steps.length >= 2) return (steps[0] + steps[1]) / 2.0;
      return steps[card.step!];
    case 3:
      if (card.step! + 1 === steps.length) {
        card.state = REVIEW;
        card.step = null;
        return nextInterval(card.stability!) * DAY;
      }
      card.step = card.step! + 1;
      return steps[card.step];
    case 4:
      card.state = REVIEW;
      card.step = null;
      return nextInterval(card.stability!) * DAY;
  }
}

/** `Scheduler.review_card`: the card after `rating` at `now`. */
export function reviewCard(before: FsrsCard, rating: Rating, now: number): FsrsCard {
  const card = { ...before };
  const daysSince = card.lastReview !== null ? Math.floor((now - card.lastReview) / DAY) : null;
  let interval: number;
  if (card.state === LEARNING || card.state === RELEARNING) {
    if (card.state === LEARNING && (card.stability === null || card.difficulty === null)) {
      card.stability = initialStability(rating);
      card.difficulty = initialDifficulty(rating, true);
    } else if (daysSince !== null && daysSince < 1) {
      card.stability = shortTermStability(card.stability!, rating);
      card.difficulty = nextDifficulty(card.difficulty!, rating);
    } else {
      card.stability = nextStability(card.difficulty!, card.stability!, retrievability(card, now), rating);
      card.difficulty = nextDifficulty(card.difficulty!, rating);
    }
    interval = stepped(card, rating, card.state === LEARNING ? LEARNING_STEPS : RELEARNING_STEPS);
  } else if (card.state === REVIEW) {
    card.stability =
      daysSince !== null && daysSince < 1
        ? shortTermStability(card.stability!, rating)
        : nextStability(card.difficulty!, card.stability!, retrievability(card, now), rating);
    card.difficulty = nextDifficulty(card.difficulty!, rating);
    if (rating === 1) {
      card.state = RELEARNING;
      card.step = 0;
      interval = RELEARNING_STEPS[0];
    } else {
      interval = nextInterval(card.stability) * DAY;
    }
  } else {
    throw new Error(`unknown card state ${card.state}`);
  }
  card.due = now + interval;
  card.lastReview = now;
  return card;
}
