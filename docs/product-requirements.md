# Product requirements

Source of truth for scope: [`coding-agent-plan.md`](coding-agent-plan.md) (the engineering brief). This document records how we interpret it, what exists today, and what still has to be decided.

## Problem

Russian-speaking students (initially in Kyrgyzstan) want a stronger English vocabulary but struggle to study consistently and forget words over time. Existing options are either unstructured (word lists, flashcard decks they build themselves) or not tuned to this audience.

## Target user

A student who studies on a phone, in short sessions, with Russian as the explanation language. The pilot is a small group of real learners. **Learner age is not decided yet**, so the product is designed for the stricter case — minors (see *Privacy*).

## Hypotheses and how the pilot tests them

| Hypothesis | Evidence we will look for |
|---|---|
| The starter words are useful to these students | Learners and a teacher rate the deck; few words reported as "already known" or "useless" |
| Exercises are understandable without help | First session completed unassisted in observed tests; few hesitations or wrong taps on controls |
| A short session works on a phone | Session completion rate; median session length ≈ 3–5 minutes |
| Learners return without reminders | Share of learners with a session on day 1 and in week 1 after their first session, with no personal nudges |
| Words are remembered after a delay | Correct-answer rate on reviews ≥ 1 day and ≥ 7 days after the previous exposure |
| People would pay for more content / competitions | Asked directly in pilot interviews; **nothing is built for this before evidence** |

Numbers are a baseline to learn from, not targets.

**North Star (draft):** words correctly recalled after a meaningful delay per active learner per week. Proposed definitions, to confirm before use: *meaningful delay* = at least 24 hours since the word was last seen; *recalled* = correct on a production or recall exercise (not multiple choice); *active learner* = completed at least one session that week.

## Learning vocabulary (definitions used in UI and data)

- **Introduced** — the learner has seen the word, its translation and example for the first time.
- **Recognised** — chose the correct meaning among options. Weak evidence; never shown as "learned".
- **Recalled** — produced the word or meaning without options (typed, or recall-before-reveal).
- **Recalled after a delay** — recalled at least 24 hours after the previous exposure. The strongest evidence we measure.
- **Currently well learned** — provisional: recalled after a delay on the last two scheduled reviews, with the latest interval ≥ 7 days. Never "mastered".

## Scope

P0, P1 and out-of-scope lists are as in the brief (§4). Interpretation for the first release:

- **Exercise types:** introduce card → choose the meaning (en→ru, recognition) → type the word (ru→en, production). A recall-before-reveal review mode arrives with spaced repetition (Phase 3).
- **Images** are optional. Only five original illustrations exist; every exercise must work without one, using the example sentence as the visual focus. During multiple choice the picture is not shown before answering, so learners cannot match picture→translation without reading the English word.
- **Interface language:** Russian copy, English learning content. Copy is kept in components for now; extraction into a message file happens only when a second interface language is actually needed.
- **Platform:** mobile-first web app; PWA install later.

## Current state vs P0

| P0 area | Today | Gap |
|---|---|---|
| A. Accounts and persistence | None; state is in memory | Backend, database, auth seam (Phase 1–2), auth provider (Phase 4) |
| B. Vocabulary content | 5 hard-coded demo words, no examples or POS | Starter deck with validation and import (Phase 2) |
| C. Learning session | Multiple choice with feedback, summary, practise mistakes | Introduce card, typing, server-checked answers, resume (Phase 2); reviews (Phase 3) |
| D. Spaced repetition | None | Scheduler and due reviews (Phase 3) |
| E. Progress | Per-session summary only | Persistent progress (Phase 2), dashboard (Phase 3) |
| F. Gamification | Progress bar, completion badge | Points and daily goal (Phase 3) |
| G. Responsive interface | Lesson and summary screens designed and screenshot-tested at 320–1440px | Home screen, loading/error states, new exercise views (Phase 2) |

## Acceptance criteria by phase

- **Phase 1:** a developer clones the repo, follows the README, runs both apps and all checks without guessing; CI runs on every pull request.
- **Phase 2:** a learner opens the starter deck, learns new words, answers multiple-choice and typing exercises with feedback, completes the session, and after a refresh still sees their progress; an unfinished session resumes; a repeated submission is counted once.
- **Phase 3:** a word reviewed today gets a deterministic next-review time; due reviews are offered before new words; the same learner sees the same progress on another device.
- **Phase 4:** a real user signs up, learns, returns on another device and sees saved progress; no user can read or change another's data; staging deployment and a tested restore exist.

## Privacy requirements (designed for minors)

- Collect only what the product needs: an auth-provider identifier, an optional display name, learning records. No birth date, phone number or location.
- Typed answers are evaluated and discarded; only correct/incorrect is stored.
- No third-party analytics, advertising or tracking SDKs. Product analytics come from our own learning records.
- Account deletion removes the user's progress and attempts (required before any public launch).
- Before the pilot collects real student data: decide the account model (self sign-up vs teacher-created accounts) and confirm obligations under the personal-data law of the Kyrgyz Republic, including consent for minors. Not yet done.

## Content requirements

- Starter deck: begins with 30 words for the first slice, grows to 100–200 after review.
- Words are chosen from an openly licensed high-frequency list (the New General Service List); licence terms and attribution are verified before release. No claim is made about how much everyday English the deck covers.
- Example sentences are written for this project. Russian translations are drafted by the developer and **must be reviewed by a fluent speaker or teacher before the pilot**.

## Open questions

1. Learner age and account model (self sign-up, teacher-created, or both).
2. Auth/database/hosting provider — pricing, availability from Kyrgyzstan, data export, payment method (decided before Phase 4; see `architecture.md`).
3. Who reviews the Russian content, and by when.
4. Daily goal size (words or minutes) — decided with pilot feedback.
