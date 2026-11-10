# 0065 — A course level given to a group

**Status:** Accepted (the owner's report from the phone test, 10 November 2026). Amends ADR 0014 and 0036.

## Context
On the phone test, the owner could make a group of friends but couldn't give it a level of the course. Only a deck one wrote could be given (`decks.publish` took own decks only), and later levels couldn't even be opened.

## Decision
- **A group's owner may give any published course level** to their group, from the level's page, with «Дать группе». A deadline, taking it back and giving it again work as for one's own deck.
- **Giving never changes the course:** its status, words and change number stay as they are, and the editor still refuses it.
- **A given level is open** to every member who studies the course, whatever level they are on. This holds on the server (`sessions`), in the study pack (`given`), and on the device (`isLocked`). It still counts in the course's one pace. Taken back, it locks again; what was learned stays.
- **The course is only for those studying in Russian** (ADR 0055), so a given level doesn't reach other members.
- **Many people may give the same level.** Each giver sees only the groups they are in.
- **A locked level now opens its page,** to see it or give it. The page has no lesson and says «Откроется после предыдущего уровня».

## Verification
- `test_decks_api.py::test_a_course_level_is_given_to_a_group_and_open_to_its_members`
- `e2e/course-to-group.spec.ts`
- the device unit test in `lessons.test.ts`
