# Product requirements

Source of truth for scope: [`coding-agent-plan.md`](coding-agent-plan.md) (the engineering brief). This document records how we interpret it, what exists today, and what still has to be decided.

## Problem

Russian-speaking students (initially in Kyrgyzstan) want a stronger English vocabulary but struggle to study consistently and forget words over time. Existing options are either unstructured (word lists, flashcard decks they build themselves) or not tuned to this audience.

## Target user

A student who studies on a phone, in short sessions, with Russian as the explanation language. The pilot is a small group of real learners. **Learner age is not decided yet**, so the product is designed for the stricter case — minors (see _Privacy_).

## Hypotheses and how the pilot tests them

| Hypothesis                                       | Evidence we will look for                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| The starter words are useful to these students   | Learners and a teacher rate the deck; few words reported as "already known" or "useless"                   |
| Exercises are understandable without help        | First session completed unassisted in observed tests; few hesitations or wrong taps on controls            |
| A short session works on a phone                 | Session completion rate; median session length ≈ 3–5 minutes                                               |
| Learners return without reminders                | Share of learners with a session on day 1 and in week 1 after their first session, with no personal nudges |
| Words are remembered after a delay               | Correct-answer rate on reviews ≥ 1 day and ≥ 7 days after the previous exposure                            |
| People would pay for more content / competitions | Asked directly in pilot interviews; **nothing is built for this before evidence**                          |

Numbers are a baseline to learn from, not targets.

**North Star (draft):** words correctly recalled after a meaningful delay per active learner per week. Proposed definitions, to confirm before use: _meaningful delay_ = at least 24 hours since the word was last seen; _recalled_ = correct on a production or recall exercise (not multiple choice); _active learner_ = completed at least one session that week.

## Learning vocabulary (definitions used in UI and data)

- **Introduced** — the learner has seen the word, its translation and example for the first time.
- **Recognised** — chose the correct meaning among options. Weak evidence; never shown as "learned".
- **Recalled** — produced the word or meaning without options (typed, or recall-before-reveal).
- **Recalled after a delay** — recalled at least 24 hours after the previous exposure. The strongest evidence we measure.
- **Currently well learned** — provisional: recalled in three scheduled reviews in a row, the latest after an interval of at least 7 days (scheduler stage ≥ 4, ADR 0006). Never "mastered".

## Scope

P0, P1 and out-of-scope lists are as in the brief (§4). Interpretation for the first release:

- **Exercise types:** introduce card → choose the meaning (en→ru, recognition) → type the word (ru→en, production). A recall-before-reveal review mode arrives with spaced repetition (Phase 3).
- **Images** are optional. Only five original illustrations exist; every exercise must work without one, using the example sentence as the visual focus. During multiple choice the picture is not shown before answering, so learners cannot match picture→translation without reading the English word.
- **Interface language:** Russian copy, English learning content. Copy is kept in components for now; extraction into a message file happens only when a second interface language is actually needed.
- **Platform:** mobile-first web app; PWA install later.

## Current state vs P0 (after Phase 3)

| P0 area                     | Today                                                                                                                                                                                                                      | Gap                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Accounts and persistence | Server-side persistence with an auth seam (development user)                                                                                                                                                               | Auth provider and sign-up (Phase 4)                                                                                                             |
| B. Vocabulary content       | 30-word starter deck (draft) with validation and an idempotent import; course goal: about 1,300 NGSL words ≈ 80% of everyday text                                                                                          | Russian review; swap the 4 words outside the NGSL top 1,300; grow toward the goal in NGSL order                                                 |
| C. Learning session         | New words: introduce → choose → type. Reviews: recall → type. Server-checked, resumable, summaries distinguish meeting a word from recalling it later                                                                      | —                                                                                                                                               |
| D. Spaced repetition        | Leitner scheduler (1/3/7/16/35 days); review sessions with recall-before-reveal; due words first                                                                                                                           | Validate intervals with pilot data                                                                                                              |
| E. Progress                 | Progress screen: words met / reviewing / currently well learned / due, 7-day activity, delayed-recall rate (labelled as such), total points                                                                                | Validate with pilot learners                                                                                                                    |
| F. Gamification             | Points for evidence of learning (none for practice), daily goal (30), streak, session points on the summary; a sourced course goal and a learner-chosen daily pace with ramp, review-debt brake and suggestions (ADR 0010) | Validate goal size and pace thresholds; roadmap with finish dates, stepping-stone path, word list, friend groups with a weekly board (ADR 0011) |
| G. Responsive interface     | Home, lesson (3 exercise types), summary; loading/error/retry states; screenshot-tested at 320–1440px                                                                                                                      | Real-device checks (iOS Safari, on-screen keyboard)                                                                                             |

## Acceptance criteria by phase

- **Phase 1:** a developer clones the repo, follows the README, runs both apps and all checks without guessing; CI runs on every pull request.
- **Phase 2:** a learner opens the starter deck, learns new words, answers multiple-choice and typing exercises with feedback, completes the session, and after a refresh still sees their progress; an unfinished session resumes; a repeated submission is counted once.
- **Phase 3:** a word reviewed today gets a deterministic next-review time; due reviews are offered before new words; the same learner sees the same progress on another device.
- **Phase 4:** a real user signs up, learns, returns on another device and sees saved progress; no user can read or change another's data; staging deployment and a tested restore exist.

## Privacy requirements (designed for minors)

- Collect only what the product needs: an auth-provider identifier, an optional display name, learning records. No birth date, phone number or location.
- Typed answers are evaluated and discarded; only correct/incorrect is stored.
- A teacher's lesson text pasted for drafting a deck is sent to DeepSeek and not stored by us; only each card's source sentence is kept (ADR 0018). DeepSeek's data-handling terms (a service based in China) must be checked against the data law that applies to schools before real school material is used.
- No third-party analytics, advertising or tracking SDKs. Product analytics come from our own learning records.
- Account deletion removes the user's progress and attempts (required before any public launch).
- Before the pilot collects real student data: decide the account model (self sign-up vs teacher-created accounts) and confirm obligations under the personal-data law of the Kyrgyz Republic, including consent for minors. Not yet done.

## Content requirements

- Starter deck: begins with 30 words for the first slice, grows to 100–200 after review.
- The first 30 are everyday A1–A2 words chosen by hand for the slice. Before the pilot they are cross-checked against an openly licensed high-frequency list (the New General Service List — licence terms and attribution verified then). No claim is made about how much everyday English the deck covers.
- Example sentences are written for this project. Russian translations are drafted by the developer and **must be reviewed by a fluent speaker or teacher before the pilot**.

## Open questions

1. Learner age and account model (self sign-up, teacher-created, or both).
2. Auth/database/hosting provider — pricing, availability from Kyrgyzstan, data export, payment method (decided before Phase 4; see `architecture.md`).
3. Who reviews the Russian content, and by when.
4. Daily goal size — 30 points for now (ADR 0008); revisit with pilot data.
