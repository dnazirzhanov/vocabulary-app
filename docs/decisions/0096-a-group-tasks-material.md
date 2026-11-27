# 0096 — A group task's material: link a deck, reading, essay, speaking question or shadowing

**Status:** Accepted (the owner, 26 November 2026: «have a task like learn new words every day and then link a
deck. same thing we should be able to do with reading, writing, speaking, shadowing tasks. every thing has to be
linkable»). The owner chose that a link opens its item for every member, testers or not, and that doing the
material ticks the task by itself.

## Decision
- **One material per group task:** `tasks.link_kind` (deck, reading, writing, speaking, shadowing), `link_ref`
  (the item's id) and `link_title` (its title when linked). The columns are nullable, so the change is
  backward-compatible. A learner's own task has no material; it is the teacher's to set.
- **Linking checks the item and makes it the group's:**
  - **A deck** is given to the group, as «Дать группе» does: the teacher's own deck, or a course level.
  - **A reading** is given to the group once, with no words or questions of its own. Linking it again
    doesn't give it twice.
  - **An essay question, a speaking question or a shadowing exercise** must exist in the app.
- **Members open it from the task.** Both the task view (in «Планы» and on the group's page) and the teacher's
  opened task show «Материал», its kind and title, and «Открыть». The task row shows only the kind, with a
  paperclip. Each kind opens its own screen: the deck's page, the text, the writing screen on that question, the
  speaking question, or the shadowing player.
- **It opens even where the section is closed** (Чтение, Письмо and Речь are for testers in production):
  - Reading, writing and shadowing were never closed on the server.
  - Speaking now lets a member list and answer exactly the questions their groups' tasks link. Teachers may list
    every question, to pick one.
- **Doing it ticks the task «по занятию»** that day, on the learner's own clock, as practising ticks a study task
  (ADR 0086):
  - a lesson finished on the deck;
  - the reading's questions answered;
  - the essay sent;
  - a speaking answer assessed;
  - a shadowing attempt completed.
  A linked one-off is done once its material is done, any day. A tick or a skip of one's own still wins.
- **Picking:** «Материал» (a paperclip) in the group's quick add, with one tab per kind and a search. It lists
  the teacher's own decks, library articles and own texts, every IELTS question, every speaking question, and the
  shadowing exercises.
