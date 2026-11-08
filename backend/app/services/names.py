"""A learner's name (ADR 0057): asked once at the start, shown in every group they are in.

Learners may be minors, so a name can carry nothing that reaches them outside the app: no links,
no e-mail (the alphabet has no "@", and a dot only ends a word, as in «Анна К.»), no phone-like
runs of digits (ADR 0011).
"""

import re

from app.core.errors import ApiError
from app.models import User

MAX_LENGTH = 20
# Letters and digits of any language (ң, ө, ҷ, ʻ…), with a space, hyphen or apostrophe (O'g'il),
# and a dot at the end of a word (an initial).
_NAME = re.compile(rf"(?:[^\W_]|[ '‘’.-]){{2,{MAX_LENGTH}}}")
_DOT_INSIDE = re.compile(r"\.\S")
LINK_LIKE = re.compile(r"(https?|www)", re.IGNORECASE)


def squash(text: str) -> str:
    return " ".join(text.split())


def clean_name(raw: str) -> str:
    """Letters, digits, spaces, hyphens and apostrophes, 2–20 characters, and not a number."""
    name = squash(raw)
    if not _NAME.fullmatch(name) or _DOT_INSIDE.search(name) or name.startswith("."):
        raise ApiError(422, "invalid_name", "Use 2–20 letters, digits, spaces or hyphens")
    digits = sum(character.isdigit() for character in name)
    if digits >= 5 or digits == len(re.sub(r"[ '‘’.-]", "", name)):
        raise ApiError(422, "invalid_name", "A name cannot be a number")
    if LINK_LIKE.search(name):
        raise ApiError(422, "invalid_name", "A name cannot contain a link")
    return name


def require_name(user: User) -> str:
    """Joining or starting a group needs a name: everyone in a group is shown by it."""
    if user.name is None:
        raise ApiError(409, "name_required", "Say your name before joining a group")
    return user.name


def shown_name(user: User) -> str:
    """A member's name; every member has one, since joining needs it (`require_name`)."""
    return user.name or ""
