"""The single place handlers learn who is calling (ADR 0004)."""

import re
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import ApiError
from app.models import User

DEV_USER_HEADER = "X-Dev-User"
_DEV_NAME = re.compile(r"[a-z0-9-]{1,32}")


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    # AUTH_MODE is "dev" until Phase 4, and settings validation keeps it out of production.
    # The header only picks between local development identities; it is never honoured otherwise.
    assert settings.auth_mode == "dev"
    name = request.headers.get(DEV_USER_HEADER, "local")
    if not _DEV_NAME.fullmatch(name):
        raise ApiError(400, "invalid_dev_user", f"{DEV_USER_HEADER} must match [a-z0-9-]{{1,32}}")
    subject = f"dev|{name}"

    user = db.scalar(select(User).where(User.auth_subject == subject))
    if user is None:
        db.execute(
            insert(User)
            .values(auth_subject=subject)
            .on_conflict_do_nothing(index_elements=[User.auth_subject])
        )
        db.commit()
        user = db.scalar(select(User).where(User.auth_subject == subject))
    assert user is not None
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]
