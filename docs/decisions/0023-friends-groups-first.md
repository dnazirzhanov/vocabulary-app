# 0023 — «Друзья»: groups first; each group's statistics as its leaderboard

**Status:** Accepted; the three rankings are replaced by one (words learned) in ADR 0027. Supersedes the ranking and the shared goal of ADR 0011 and ADR 0015 (places
only by the promise kept; extra work never on the board).

## Context
With several groups and many decks, «Друзья» felt lost: with one group it jumped straight to a
board, and the board ranked only by the share of one's own promise kept, so «3 из 3 дней» tied
«5 из 5 дней» and nothing else was shown. The owner asked for groups listed first, each group
opened on purpose, and a leaderboard that works as members' statistics.

## Decision
- **«Друзья» is always the list of my groups.** Each row: name, members, my place this week, and
  faces of who has studied today. Creating a group and joining by code open a window each.
- **A group answers, in order:** who has studied today (names, no numbers); the ranking with my
  place and what it takes to move up («До 1-го места (Искандер): ещё 2 дня занятий», or that the
  week can no longer allow it); the leaderboard; the group's totals for the period; its decks;
  then invite, members and leaving.
- **Periods:** this week (default, a fresh start every Monday), this calendar month, all time —
  in the group's time zone; each member's days in their own zone (ADR 0011).
- **Three rankings, steadiness first:** «Регулярность» — days studied, then days with the plan
  done (ADR 0022), then weeks in a row; «Выучено» — words first recalled in a later review within
  the period (the «Прогресс» definition); «Карточки» — answers of any kind. Equal values share a
  place; a member with nothing in the period has no place and is named below the board. Every row
  shows the other figures too.
- **Together** replaces the planned-words goal bar: days, words learned and cards for the whole
  group over the period — never compared.

## Consequences
- Volume can now lead a board when a member chooses that ranking; steadiness stays the default.
- `GET /api/groups/{id}/board?period=` returns all three places per row, so switching rankings
  needs no request; `GET /api/groups` carries each group's pulse.
