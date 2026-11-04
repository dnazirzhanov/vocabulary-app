# 0040 — Group rights: rename, leave, hand over, delete

**Status:** Accepted. Builds on ADR 0011 (groups, owner removes members) and ADR 0017 / 0030 (the
owner gives decks and sees who keeps up). ADR 0041 adds the Administrator role.

## Context
A group had two roles and rights scattered through the code: the owner removed members, gave decks
and saw everyone's standing; anyone could leave, but the button was folded away; when the owner
left, the longest-standing member silently took over. There was no way to rename a group, choose a
successor, delete a group or replace a leaked invite link.

## Decision
**One table says who may do what** (`services/group_rights.py`), and the API tells each caller what
they may do (`GroupOut.can`), so the web never repeats it. Everyone in a group may see it, share its
invite link and leave; those are not in the table.

| Action | Member | Owner |
|---|---|---|
| Rename the group | | ✓ |
| Give / take back decks, change deadlines | | ✓ |
| See everyone's deadline standing | own | ✓ |
| Reset the invite link | | ✓ |
| Remove a member | | ✓ (not themselves) |
| Hand ownership over | | ✓ |
| Delete the group | | ✓ |

Exactly one person owns a group, and a group with no members is deleted.

### Leaving
- Anyone may leave, from a quiet link at the bottom of the page, never folded away. It is grey: a
  right, not an alarm. A member confirms once.
- **An owner who leaves names who takes over** («Кому передать группу?»): a list of the others, no
  default, then «Передать и выйти». Alone, they are told the group goes with them.
- The server keeps the automatic hand-over to the longest-standing member when no successor is
  named, so deleting an account (`leave_all`) still works.
- Someone who left can return by the invite link under any free name. Their promise history is
  theirs and is untouched.

### Renaming
- A pencil next to the name turns it into a field in place, as on a deck's page (ADR 0035).
  Same rules as creating: 2–40 characters, no links. Escape cancels from anywhere in the form.

### People
- A person's window (ADR 0039) gets a «Управление» section for those who may: «Сделать владельцем»
  (the owner becomes an ordinary member) and «Удалить из группы», each asking once. Nobody manages
  themselves; they leave. This replaces the separate «Участники (N)» list.

### The invite link
- Everyone in the group can share the link. The owner can make a new one («Новая ссылка», asking
  first); the old link and QR code stop working, and nobody already in the group is affected.

### Deleting
- «Удалить группу» is folded under «Управление группой» for the owner and says what goes and what
  stays: the memberships and the group's assignments go; decks stay with their authors (who can
  give them to another group) and what everyone learned stays with them.

## API
- `PATCH /groups/{id}` `{name}`; `POST /groups/{id}/invite`; `PUT /groups/{id}/owner`
  `{member_id}`; `DELETE /groups/{id}`;
  `DELETE /groups/{id}/members/me?successor={member_id}`.
- `GroupOut` gains `can`. Removing yourself is refused (`cannot_remove_self`): leave instead.
- Error codes `not_owner` and `not_group_owner` stay; new ones are `not_allowed` and
  `already_owner`.

## Not in scope
- Changing your own nickname, banning someone from returning, several owners (ADR 0041 adds admins).
