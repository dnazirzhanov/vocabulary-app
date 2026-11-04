"""Who may do what in a group (ADR 0040): one table, so no endpoint decides on its own.

Everyone in a group may see it, share its invite link and leave; those are not listed. What only
some roles may do is an action here. The API returns the actions the caller may do (`GroupOut.can`)
so the web never repeats this table.
"""

from typing import Final

from app.core.errors import ApiError
from app.schemas.groups import Action

# The roles allowed each action. For now only the owner manages; the Administrator joins later.
RIGHTS: Final[dict[Action, frozenset[str]]] = {
    "rename": frozenset({"owner"}),
    "give_decks": frozenset({"owner"}),
    "see_standings": frozenset({"owner"}),
    "reset_invite": frozenset({"owner"}),
    "remove_member": frozenset({"owner"}),
    "transfer_ownership": frozenset({"owner"}),
    "delete_group": frozenset({"owner"}),
}


def can(role: str, action: Action) -> bool:
    return role in RIGHTS[action]


def actions_for(role: str) -> list[Action]:
    return [action for action in RIGHTS if can(role, action)]


def require(
    role: str, action: Action, code: str = "not_allowed", message: str | None = None
) -> None:
    """403 when the role may not do the action: the caller can see the group, so it isn't a 404."""
    if not can(role, action):
        raise ApiError(403, code, message or "Your role in this group does not allow that")
