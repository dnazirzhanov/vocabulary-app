# 0057 — One name per person, asked at the start and shown in every group

**Status:** Accepted (the owner's request, 7 November 2026). Replaces ADR 0011's nickname per group and its generated names, adds a question to ADR 0045's first run, and brings in what ADR 0040 left out (changing one's own name).

## Context
A learner had no name of their own: each time they made or joined a group they typed or picked a nickname for that group («Весёлый Кот»). The owner wants the app to ask the name once at the start, keep it with the profile, and show it to friends in every group.

## Decision
- **One name**, `users.name` (2–20 characters), asked right after the language on the first run: «Как вас зовут?», one field and «Дальше». Learners from before it are asked it once, and only it.
- **Groups show it.** Making or joining a group asks nothing more, and the server refuses both (409 `name_required`) to someone without a name. `group_members.nickname` is gone; every list, test result and deck author reads the name, so changing it in ⚙ («Имя») changes it everywhere at once.
- **Two people in a group may share a name.** A class has two Анна, and one name for every group can't be refused because of someone in one of them. The hint suggests a surname initial («Анна К.»); a dot is allowed at the end of a word for it.
- **Same rules against contact details** (ADR 0011): letters of any of the app's languages, digits, spaces, hyphens, apostrophes; no "@", no dot inside a word, no links, no phone-like digit runs. Checked on the server (`services/names.py`) and mirrored in the web (`lib/name.ts`).
- **No age.** Nothing about a child's age is stored until a feature needs it.
- **Existing members** keep the nickname of the first group they joined, as their name.

## Consequences
- Real names are personal data, and learners may be minors: classmates see them. ADR 0046's «Не сдали» list is no longer softened by nicknames. A name is still deleted with the account, and never appears in notifications (counts only).
- Two members with the same name look alike on a group's page; nothing enforces the initial.
- Learners already using the app see one new screen on their next visit.
