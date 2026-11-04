# 0011 — Friend groups with a weekly board that rewards showing up

**Status:** Accepted. Ranking, shared goal and opening a lone group straight away superseded by
ADR 0023.

## Context
Pilot feedback, backed by Arnett (Oct 2026): motivation, not explanation, is the bottleneck in
learning, and it comes largely from relationships and community. Learners asked for a friends'
leaderboard. Research on leaderboards is mixed: relative boards (you and people near you) motivate
across levels, while absolute rankings can demotivate low performers
([HKU](https://hub.hku.hk/handle/10722/368255), [LSE](https://researchonline.lse.ac.uk/id/eprint/115983)).
Learners may be minors.

## Decision
- **Groups, not a global ranking.** Anyone can create a group (at most 5 per learner, 50 members)
  and share an 8-character invite code (no 0/O/1/I), a link `/join/CODE` or a QR code made in the
  browser (`qrcode`, MIT) so codes never reach a third-party service. The link survives sign-in and
  the first-run screens in `sessionStorage`. Preview and join are rate-limited (10 a minute per
  learner) so codes cannot be guessed.
- **Nicknames only.** Members see a nickname, a member id and weekly numbers — never an e-mail or a
  user id. Nicknames are generated (Russian adjective + animal) or typed: 2–20 letters, digits,
  spaces or hyphens, no "@" or ".", no links, no phone-like digit runs, unique per group ignoring
  case. No chat. The owner can remove members; when the owner leaves (or deletes their account) the
  longest-standing member takes over, and an empty group is deleted.
- **Ranking: days practised this week, then points.** A day counts when the member met the 30-point
  daily goal, in the member's own time zone (stored from `X-Time-Zone`, accepted only if PostgreSQL
  knows it). The week is Monday–Sunday in the group's zone. Ties share a place. Members with no
  points this week are listed under «Ещё не начали на этой неделе» without a place. Boards over 10
  ranked members show the top 3 plus the learner and two neighbours each side.
- **A shared goal next to the ranking:** new words met by everyone this week against everyone's
  plans combined (daily target × study days, at least 20), with a "по плану к сегодня" marker.
- **Home shows the learner's place** («вы на 2-м месте из 7»), because a board nobody opens cannot
  motivate.
- `make seed-classmates` (development databases only) creates a demo group of six made-up
  classmates for the local dev user, so the board can be tried without other people.

## Consequences
- A 3-words-a-day learner who practises daily outranks a 100-words learner who practised twice.
- Groups store one more piece of personal data: a nickname. It is deleted with the account.
- The effect on motivation is a pilot hypothesis to measure: return rate of group members vs others.
- Invite links only work for others once the app is deployed.
