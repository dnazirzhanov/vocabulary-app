from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    try:
        db.execute(text("select 1"))
    except OperationalError as exc:
        raise ApiError(503, "database_unavailable", "Database is not reachable") from exc
    return {"status": "ok", "database": "ok"}
