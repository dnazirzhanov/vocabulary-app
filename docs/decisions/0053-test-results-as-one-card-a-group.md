# 0053 — A test's results as one card a group, with each score as a bar

**Status:** Accepted (the owner's request, 6 November 2026).

## Context

A deck's test page listed people as loose rows on the page: every name, heading and score in the same bold, big gaps, and a tall empty row for each person who had no score. The owner found it ugly. The ring beside «Не сдали» was also the group page's "today, still open" mark, larger than the others and the wrong meaning for a test someone didn't pass.

## Decision

- Each of «Сдали» and «Не сдали» is one card in the style of «Прогресс», with a row a person, parted by a line. My own row is tinted, as on a friend's card.
- A row is a name, a small bar and the score in words. The bar is orange for a pass and graphite for a miss, never red, and the heading says the same in words.
- «Ещё не проходили» is one card of names in a run, parted by commas, because there is no score to line up and a whole class waiting should stay short.
- «Не сдали» has the neutral dashed ring of a missed day. The group page's headings stay as they are.

The order doesn't change: me first, then by name. A bar makes a score quicker to read, so sorting by score would turn the list into a ranking, which [ADR 0046](0046-group-spelling-tests.md) rules out.

## Consequences

A low score is easier to see at a glance than before, though it was already public to the group by the owner's decision. If that proves unkind in a real class, dropping the bars is a small change.
