# Reading Mode: decisions

Each decision lists the options that were considered and why one was chosen. The owner's decisions
are marked ★ (November 2026).

## 1. Who sees it ★
Chosen: **a fourth tab «Чтение», for tester accounts only** (`READING_TESTERS`).
- Not everyone at once: the experiment should be tried by a few people first, in production, with
  real accounts.
- Not a row on home: reading is meant to become the main experience; a tab tests that honestly.

## 2. The basket ★
Chosen: **the article's own deck, created on the first «Добавить»; each word is a card at once.**
- **A local draft turned into a deck at the end** (the brief's literal wording): lost on another
  device, it needs new storage, and it duplicates what decks already do.
- **One shared «Из чтения» deck:** loses which article a word came from, and the basket per article.
- The deck **is** the basket, so removing a word is deleting its card, and «Создать карточки» becomes
  «Учить N слов». There's no second flashcard system and no schema change.

## 3. Languages ★
Chosen: **Russian only for now**, stored as a field per language so others can be added
([reading-mode-languages.md](../../product/reading-mode-languages.md)).

## 4. Content ★
Chosen: **free-licensed texts, credited** (VOA Learning English, Simple English Wikipedia, NASA),
plus 1–2 originals for gaps.
- BBC, National Geographic and similar are copyrighted: reproducing the text needs a licence.
- The Conversation (CC BY-ND) may be shown verbatim but **not adapted**, so it's only usable as-is
  at C1.
- Simple English Wikipedia adaptations remain **CC BY-SA**.
- **VOA: only stories VOA wrote itself.** Many VOA Learning English stories are adapted from AP,
  AFP or Reuters reports (their credit says so). Those texts belong to the agency, so they're left
  out. Checked: «Saying No at Work», health and gardening stories (AP); «Stonehenge-like circle»
  and «Earth's orbit» (AFP).
- **Simple English Wikipedia only where it reads well.** «Honey bee» was too technical for A2
  (genus, eusocial, haploid); «Tea», «Internet» and «Volcano» were shortened to their readable
  parts.
- **The first library is 7 articles:** A2 ×1, B1 ×4, B2 ×2; history, science ×2, culture,
  technology, nature, psychology. There's no C1 text yet: a VOA text shouldn't be labelled C1.

## 4b. Fewer meanings to write: a shared glossary and names
- Meanings common to many articles are written once in `content/reading/_shared.yaml`.
- People and places are a plain `names:` list per article.
- About 460 shared entries plus 15–30 per article cover 7 articles, instead of ~1,000 repeated
  entries.

## 5. Where articles live
Chosen: **YAML in the repo → static JSON in `web/public/reading/`.**
- **Database tables and an API:** a migration, pagination and an editing tool, all for about eight
  curated texts. To revisit when articles are written by people outside the repo.
- **Bundled into the JS:** grows a chunk and ties content edits to code.
- Static files ship inside the Android app (offline from install) and are cached by the service
  worker on the website.

## 6. Meanings on tap
Chosen: **every word's meaning prepared per article and shipped with it**; common words come from
the course glossary.
- **An AI call per tap:** slow, costly, nothing offline, and unreviewed.
- **The existing `/api/glossary`:** covers course words only, and needs the network.
- A validator fails the build if any word lacks a meaning, so the reader never shows "no
  translation" for article text.

## 7. Making words tappable
Chosen: **a span per word, one delegated `click` listener on the article.**
- **A button per word** (as on flashcards): about 1,500 tab stops, heavier, and words look like
  controls.
- **Plain text + `caretRangeFromPoint` + the CSS Custom Highlight API:** the lightest DOM, but
  uneven on older Android WebViews and Samsung Internet. Kept for v2 if measurements call for it.
- `click` doesn't fire after a scroll or drag, which gives the "no accidental selection when
  scrolling" requirement for free.

## 8. Showing saved words
Chosen: **one generated `<style>` rule listing the basket's lemmas.** Saving a word restyles it
without re-rendering a 1,500-span article. The alternative, React state per word, re-renders the
article on every save.

## 9. The word sheet
Chosen: **a non-modal sheet at the bottom.**
- **The existing modal dialog:** its backdrop hides the text the learner is reading.
- **A popover beside the word:** cramped on phones, and covers the next lines.

## 10. Reading font
Chosen: **Literata** (variable, OFL, designed for long reading on screens; Latin subset, loaded by
the reader only).
- Considered: Source Serif 4, Lora, the system serif. Charter isn't available as a web font
  package.
- The interface stays Nunito.

## 11. Reading progress
Chosen: **on the device only** (localStorage per account) for the experiment.
- **Syncing it** needs a table and sync ops; to do if testers read on more than one device.

## 12. Finding the article's deck on another device
Chosen: **by an id map on the device, else the deck's exact title.** A renamed deck starts a new
basket.
- The robust fix, a nullable `decks.source` column (an additive migration), waits until the
  experiment proves itself.

## 13. Service worker: network-first for articles (changed from the plan)
**Chosen:** the newest file when online, the kept copy offline.
- Article files keep their names between versions (`tea.json`), unlike the app's built files.
  Cache-first would show an outdated text forever once corrected.
- Network-first costs one small request per article, and an article read once still opens offline
  (`e2e/offline-reading.spec.ts`; without the `/reading/` branch that test fails).

## 14. No hyphenation in the reader
- The first screenshots split words at line ends («de-sign», «heli-copter»). A learner reads
  whole words, and will tap them in phase 3.
- So the paragraphs use `text-wrap: pretty` instead of `hyphens: auto`, accepting a slightly
  more ragged right edge.

## 15. Testers by name or prefix
`READING_TESTERS` takes bare UIDs, `supabase|<UID>`, or a prefix ending in `*`:
- `e2e-reader-*` is how the e2e tests become testers;
- `*` alone switches Reading Mode on for everyone without a code change.

The same helper serves `CONTENT_EDITORS`.

## 16. Library: topics first, five articles each (phase 3, the owner's request)
- The library opens on topic rows only (name and count), with no article titles. One topic is
  open at a time; its first five articles show, then «Показать ещё · N».
- The open topic is remembered while the app runs, so «Назад» from an article returns to it.

## 17. Highlights and notes stay on the device
Chosen: **localStorage per account and article** (`reading-notes:<account>:<article>`).
- A highlight snaps to whole words and may cross paragraphs. It is stored as paragraph and
  character offsets, plus the quote for the list.
- Syncing them needs a table, an outbox kind and a migration. That waits until testers show they
  use notes (the hypothesis doc's measure).
- An article whose text is corrected may shift old highlights. Its quote stays right in the list.

## 18. A word's sheet and a selection never compete
A new selection closes an open word sheet and offers «Выделить» / «Заметка». Esc closes the
sheet, as ✕ does. A tap on a word while text is selected opens nothing.

## 19. The basket re-reads its deck after each change
The count and list come from the device's deck after every add and remove, not from a guess in
memory. The first version showed a stale count after the first «Добавить».

## Round 2 (owner, 2026-11-12)
The plan: own texts, a reading given to a group in one step (text, words, questions), answers by
typing or voice. Built in five PRs (R2-A to R2-E).

## 20. A deck says which reading it came from (R2-A)
`decks.reading_ref` (nullable, `library:<article id>`): set once when the deck is made, sent in
`deck.create`, pulled to every device. It replaces decision 12's lookup by a kept id or the title,
which stays only for the decks made before it.

## 21. Home: one «Из чтения» row (R2-A)
Decks made from readings leave «Мои колоды» and «Из моих групп» for one row, «Из чтения · N колод»,
which opens their own list. The «Продолжить» card still picks from every deck, so a reading's words
are one tap away when they are the next thing to study.

## 22. «Учить · N» in the reader's bar (R2-A)
The owner did not find the cards icon. Once a word is kept, the icon becomes a labelled pill that
starts the lesson on this text's words in one tap. Before any word is kept, the icon stays and says
how to keep one. A kept word is taken back from its own sheet («Убрать»), or from the deck's page.

## 23. Texts of one's own live on the server (R2-B)
`readings` and `reading_categories` (additive migration, row-level security on). A text is saved
at once and opens in the reader; a model (DeepSeek) then writes every word form's meaning as used
in this text, in the owner's card language, 150 forms per call, in the background. The reader
says «Значения слов готовятся…» and asks again every 2.5 s; an open sheet gets its meaning when
it arrives. A form the model leaves out takes the course glossary's (Russian) meaning, else the
sheet says there is none yet. A text is at most 2,000 words, and adding one spends one of the
day's 20 drafts, the same budget as decks.

## 24. Categories are names a person keeps (R2-B)
Created in «Свой текст» («＋ Новая») and shown in the library even when empty, with «Добавить
текст» inside, so one can make a category first and fill it after. Renaming keeps it open;
deleting it keeps its texts, under «Мои тексты».

## 25. Adding a text needs a connection; reading one does not (R2-B)
The meanings need the model, so there is nothing an offline «Готово» could finish; the plan's
`reading.create` outbox operation was dropped. A text opened once, its meanings included, is kept
on the device (`snapshots`) and opens offline (`e2e/offline-reading.spec.ts`).

## 26. A meaning is `t`, in the text's language (R2-B)
The reader reads `t` and the article's `language`; the library's built files keep `ru`, mapped on
load. A deck made from a text takes that language for its cards, so a text added by someone who
studies in Uzbek gives Uzbek cards.

## 27. Every text asks questions (R2-C)
The 7 library articles carry 3 questions each in their YAML (written by me, the last one asking
for the reader's own view), with word limits that suit the level; the build refuses an article
with fewer than 2 or limits out of order. A text of one's own gets 3 questions drafted in the same
model call as its meanings' first batch, so they cost no call of their own. Changing them is the
giver's tool (R2-D).

## 28. Answers: the latest one, within limits, kept on the server (R2-C)
`reading_answers` keeps each reader's latest answer to each question, with the question as it
was answered. The server checks its limits (min–max, and never over 500 words), counting words
as the reader does (the shared tokenizer). Answers travel through the outbox (`reading.answer`),
so one written offline arrives later; an older edit arriving after a newer one is kept out. They
show under the article («Вопросы к тексту», «Изменить»), and the library's row says «Ответы · n/m».

## 29. Voice: the browser's own recognition first (R2-C)
«Сказать» uses the Web Speech API (English): what is heard appears in the box as it is heard,
after anything typed, to be corrected before «Отправить». No audio reaches us. A refused
microphone is said, with typing offered; where the browser has no recognition, no button shows
(the keyboard's microphone still works). Android's web view has no Web Speech API, so the app's
own recognizer comes with R2-E.

## 30. Answers loading late never undo one just written (R2-C)
Found by a flaky offline test and made exact with a held reply: the server's list, asked when the
article opened, could come back after an answer was written and replace it, on screen and in the
device's copy. Now the questions show at once from the device's copy, and every list that arrives
is merged by time, each question keeping its newer answer.

## 31. Three questions with options, then two to think (owner, R2-C2; supersedes 27)
The owner: questions should push students to think and widen their horizon, not ask "when did X
happen". So every text now asks five:
- **three with options, on its facts:**
  - four options, the right one in a different place each time;
  - marked at once, on the device, offline too;
  - answered once, so the first try is what a teacher will see (R2-D);
- **two open ones:** inferring what the text implies, or connecting it with the reader's life or
  the wider world, within word limits, in writing or by voice.

The library's are written by me and checked against each article. For one's own texts, the model
drafts them in the same order, and the server keeps only sound ones (3–4 different options with
the right one among them; limits 1 ≤ min ≤ max ≤ 500).

The right option is in the article's file, so a determined student could find it. That is
accepted for now; a teacher's test would hide it.

## 32. Unsent words are a draft on the device (R2-C2)
The owner lost an answer by leaving for another tab before «Отправить». Every change to an open
answer's box is kept on the device (`answer-draft:<account>:<question>`) and comes back when the
article opens again; sending or «Отмена» clears it.

## 33. The library's count includes answers not sent yet (R2-C2)
«Ответы · n/5» takes, for each text, the larger of the server's count and this device's, so it
is right at once after answering, and offline.

## 34. Refused changes are logged (R2-C2)
"Were my answers received?" had no answer in the logs: a refused sync change was silent. The
server now logs each refused one by kind and reason (never its content).

## 35. A reading given to a group, in one step (R2-D1)
`reading_assignments` (additive migration, RLS on) holds:
- the group and the text (a library article, or the giver's own);
- the giver, an optional deadline, and when it was given or taken back;
- the deck its words became.

How it works:
- **Who gives:** any member gives a reading to their group (owner's decision). Its giver and the
  group's owner may take it back, and its deck goes with it; what was learned and answered stays.
- **Where:** «Дать группе» is a quiet link at the end of every text. It opens one screen, filled in
  so most givers only pick the group:
  - the group (the only one already picked) and a deadline;
  - the words to learn from the text, as chips: the giver's own kept words picked, and the text's
    others offered, everyday words left out;
  - the questions, copied from the text's, to change, drop or add (limits for open ones).
- **The words** become a deck of the giver's given to the group. It is learned like any group
  deck and is listed under «Из чтения» (`decks.reading_ref = assignment:<id>`).
- **Members** find it first on the Reading tab, under «От групп» («от Ольга · 7Б · срок …»). It
  opens with its words button («Слова к тексту · N · Учить») and the giving's questions; answers
  are kept under `assignment:<id>`, apart from the same text read alone.
- **A text of one's own given to a group** becomes readable by that group; only the author's own
  texts can be given.

## 36. «Ответы группы» (R2-D2)
A given reading has «Ответы группы» under its title, for every member. It lists the group's
members, me first and then by name, never ranked:
- **every member** sees how many questions each answered («Ответы · 2/3»), or «пока без ответов»;
- **the giver and the group's owner** also see how many choice questions each got right and how
  many of its words they have met, and can tap a name to read the answers, with each pick marked
  right or wrong;
- **the giver and the group's owner** can «Забрать у группы» there, after a confirmation; answers
  and learned words stay.

`GET /api/reading-assignments/{id}/answers` sends the answers themselves only to them; others
get names and counts.

## 37. One's own questions: changed, added, true or false (owner, 2026-11-13)
On a text of one's own, «Изменить вопросы» (beside «Вопросы к тексту») opens the same editor
«Дать группе» uses:
- the AI's questions reworded, their options and right one changed, or dropped;
- new ones added in three kinds: «С вариантами» (2–4 options), «Верно / неверно» (the options
  «True» and «False», nothing to add) and «Открытый» (with word limits).

A question kept from before is changed in place (`PUT /api/readings/{id}/questions`, by its id),
so the answers to it stay; one dropped takes its answers out of the text's list. A true-or-false
question is one with options, marked at once and answered once like the others.
