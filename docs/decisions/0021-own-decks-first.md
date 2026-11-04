# 0021 — Own decks first; the course one tap away

**Status:** Accepted. Amends ADR 0020 (home).

## Context

The course's promise ("about 1,300 frequent words cover about 80% of everyday text", ADR 0010) is
not yet tested with learners, and the owner is pivoting toward decks people make themselves — by
hand or with AI — and share with groups. The owner wants that to be the app's main thing, with the
course offered, not leading.

## Decision

- **Home is «Мои колоды».** First a solid «Создать колоду» tile (name, then the editor), then
  «Созданные мной» and «Из моих групп», each deck opening its page (ADR 0020). There is no
  separate library screen any more.
- **The course is offered below.** A short card, «Английский по уровням», says in plain words what
  it is and has one button, «Открыть курс», which opens the levels (A1–A2, B1–B2, C1) with their
  counts and locks. Levels open their pages as before.
- Nothing about the course itself changes: its goal, pace, levels and progress figures stay.

## Consequences

- The progress page still measures the course's words against its sourced goal; whether that
  figure stays prominent is for a later decision.
