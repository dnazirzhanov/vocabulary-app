"""The app's own errors, reported (ADR 0094): kept so a failure on one learner's device can be
found and fixed. A few an hour per learner; longer texts are cut."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, DbSession
from app.core.clock import Now
from app.core.logging import logger
from app.core.ratelimit import limit_client_errors
from app.models import ClientError

router = APIRouter(tags=["client-errors"])


class ClientErrorIn(BaseModel):
    place: str = Field(max_length=200)
    name: str = Field(max_length=200)
    message: str = Field(max_length=4000)
    stack: str = Field(default="", max_length=8000)
    build: str = Field(default="", max_length=200)


@router.post("/client-errors", status_code=204, dependencies=[Depends(limit_client_errors)])
def report(
    body: ClientErrorIn, request: Request, user: CurrentUser, db: DbSession, now: Now
) -> None:
    db.add(
        ClientError(
            user_id=user.id,
            at=now,
            place=body.place[:80],
            name=body.name[:80],
            message=body.message[:1000],
            stack=body.stack[:4000],
            build=body.build[:80],
            agent=(request.headers.get("user-agent") or "")[:200],
        )
    )
    db.commit()
    logger.warning(
        "client error",
        extra={
            "fields": {
                "place": body.place[:80],
                "name": body.name[:80],
                "error": body.message[:300],
            }
        },
    )
