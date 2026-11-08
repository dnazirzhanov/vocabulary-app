# 0061 — Personal decks and settings sync through FastAPI: operations applied once, conflicts never overwritten

**Status:** Accepted (7 November 2026).

## Context
A learner must be able to make and change their own decks and settings without a connection (ADR 0060 keeps the app on the device). The changes reach the server later, maybe twice (a lost answer, a closed app), maybe after another device changed the same thing.

## Decision
- **Operations, not states.** A device sends what it did, in order: `deck.create`, `deck.rename`, `deck.delete`, `card.create`, `card.update`, `card.delete`, `me.update` (`POST /api/sync/push`, at most 200 at once).
- **Each operation is applied once.** Its id (made on the device) is stored with its result (`sync_ops`) in the same transaction as the change. Sent again, it gets the same answer and nothing happens twice.
- **Ids made on the device.** New decks are `g-<uuid>` and new cards `t-<uuid>`, the same prefixes as before, so old ids still work.
  - An id already used by someone else is refused as `id_taken`, without saying whose.
  - An id that was deleted is `gone`.
- **Edits name what they were made against.** A card or setting change carries, for each field, the value the device had before.
  - A field still at that value takes the new one.
  - A field already at the new value needs nothing.
  - A field changed elsewhere meanwhile is reported as a conflict with both values and never overwritten. The op's other fields are applied.
- **Deletion wins.** An edit of a deleted card or deck is `gone`; bringing it back means a new card. Deletions are remembered in `sync_tombstones` for 90 days.
- **Pulling** (`GET /api/sync/decks?cursor=`) returns my decks changed since the cursor, each with its cards in order, plus deleted decks.
  - Every change to a personal deck, from sync or the app's own routes, takes a short per-owner lock and a new number from `sync_change_seq`. A pull takes the same lock, so no change can commit under a cursor already handed out.
  - A device away longer than 90 days is refused (`resync_required`) until it pulls everything again, so it can't revive what it no longer knows was deleted.
- **One set of rules.** The decks' rules (limits, duplicates, linking course words, deleting progress) are the same functions the app's routes use, now split into a part that changes and a part that commits.
- **What stays online:** the promise and its pause (their "from tomorrow" is the server's day), AI drafting, giving a deck to a group, studying and tests.
- **Nightly cleanup** forgets tombstones and applied operations older than 90 days.

## Consequences
- A card made offline that is a course word becomes the course word on arrival, as it does online; the device is told the word's id.
- Conflicts need a choice on the device (keep mine / take the server's), which the web shows on the card.
- Every new write path to a personal deck must call `decks.mark_deck`, or devices won't see the change. The sync tests check the app's own rename is pulled.

## On the device
- My decks and cards live in IndexedDB (`local/myDecks.ts`). Each change is one transaction: the row and its outbox entry. The UI updates from it at once, with no connection needed.
- **Checked here first, against the server's rules:** the word pattern, lengths, duplicates in a deck, 500 cards, 100 decks.
- **Unsent changes are merged only where that can't change the outcome:**
  - several edits of one card become one edit, keeping what the card was before the first;
  - a card made and then changed is sent as made-and-changed;
  - a card or deck made and deleted before anything went is never sent.

  A change already on its way is never touched.
- **The sync** (`local/sync.ts`) runs on start, on reconnection, when the app is looked at again, and a second after a change. One tab at a time (a browser lock). Batches of 200.
  - A failed send leaves the changes waiting.
  - `resync_required` pulls everything, then sends.
  - A card that turned out to be a course word takes that word's id, in waiting changes too.
- **Kept online only:** AI, giving to a group and studying sync first, so a deck made offline reaches the server before they need it.
- **What the person sees:**
  - «Ждёт отправки» on unsent cards.
  - A conflict shows the other device's value, with «Оставить моё» (sent again against it) and «Взять оттуда».
  - Changes lost because their deck or card was deleted elsewhere are counted and said once on home.
  - The sign-out window says how many changes are unsent; they stay on the device for the next sign-in.
- **Settings** saved without a connection go into the same outbox with the values they replaced (`local/settings.ts`).

