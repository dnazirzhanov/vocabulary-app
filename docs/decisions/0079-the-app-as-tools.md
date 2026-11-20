# 0079 — The app as tools

**Status:** Accepted (the owner, 20 November 2026: «everything can be checked and called by our mentor»).

## Context
The mentor saw the app two ways: a few tools, and a long note pushed into every prompt. Whatever was in neither —
writing feedback, speaking results, reading answers, other days, the words that are hard, group deadlines, reminder
settings — it could only answer «не знаю». The owner's example: asked whether a task was done, it said it had no
data (fixed for today in #133).

## Decision
**The mentor sees through tools and acts through proposals.**

- **A read tool for every part of the app**, limited to the learner's own data, returning facts only (no cards):

  | Tool | What it returns |
  |---|---|
  | `get_practice(from, to)` | each day's lessons, writing, speaking, reading: when, how long, finished or not (≤ 31 days, up to 90 back) |
  | `get_words(state)` | struggling, due, recently learned or new words, with counts |
  | `get_writing()` | recent essays: question, date, level, the five scores, summary, what to improve |
  | `get_speaking()` | recent speaking: exercise, the scores, the main corrections |
  | `get_reading()` | recent articles: title, level, answers and how many were right |
  | `get_assignments()` | decks given by groups: group, deadline, words left |
  | `get_calendar(date)` | a date's blocks, kind of day, today's choice, whether it is a promised day and at what time |
  | `get_progress(period)` | a week or a month: days practised, minutes, words learned, reviews, essays, speaking, articles, promised days kept |

- **A propose tool for every change** still goes through the learner's tap and the same server checks as the app's
  own buttons. Already there: goal, week schedule, study time, a different day, kind of day, remember, start an
  activity. New: `propose_reminders` (morning, afternoon, deadlines, group report).
- **Rules:** before saying it doesn't know, the mentor calls the matching tool. Tool rounds per answer go from 3 to
  4, since a lookup is often followed by a component.
- **Checked by:** tests for each tool (facts right, another learner's data never visible, arguments bounded), the
  demo matcher for the e2e tests, and new scripted conversations for the live evals.

## The smaller prompt (second step)
What every answer needs stays in the prompt: who the learner is, the time, the streak and the promise, what is due
today, goal, level, the day's schedule and plan, today's practice, and what the mentor remembers. The other ~25
statistics lines (words in progress, learned and mastered; this and last week's numbers; retention and accuracy;
decks; reading; how long and how regularly they study) moved to `get_stats`, worded exactly as before. For a busy
learner the prompt is about 1,000 characters (16%) shorter. The 33 tests of their wording now check `get_stats`, and a
test holds them out of the prompt.
