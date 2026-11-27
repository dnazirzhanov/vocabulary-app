# 0095 — A repeating task's day is done on that day, not ahead

**Status:** Accepted (the owner, 26 November 2026: «the friends section tasks that show who is doing what … is not
accurate. for one student it marked done for tomorrow»).

## What happened
A student in Bishkek, at 17:07 on 26 November, ticked within four seconds:
- «Learn new words every day» for the 26th;
- «Read the text», a one-off due the 27th;
- «Learn new words every day» for the **27th**.

«Планы» let every day of a repeat be ticked, tomorrow's too (in «Предстоящие», or with tomorrow chosen in the week
strip). The group's page then truly showed tomorrow done. A one-off done early showed on its due day, so it also
looked like «done tomorrow».

## Decision
- **A repeat's day is done on that day or later, never ahead.**
  - The server refuses it (`not_yet`), counting «today» on the learner's own clock. Skipping a day ahead stays
    possible.
  - In «Планы» that day's checkbox is dashed and greyed out; a tap says «Отметить можно в этот день». The task's
    view shows that line instead of its button.
- **A done mark made before its day began doesn't count,** in the learner's list and on the group's page. The
  marks already made are kept, not deleted. The student's tick for the 27th is one of them, so the board no longer
  shows it, and it will not count when the 27th comes either.
- **A one-off done early is shown on the day it was done** on the group's page, not on its due day.
- **The group's page counts each member's days on their own clock** (study days included), never the group's
  (memory: time zones).
