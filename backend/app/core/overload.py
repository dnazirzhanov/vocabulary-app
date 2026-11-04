"""Refuses work the server can't finish (ADR 0044). On a small host requests that wait keep running
after the student has given up, so past its limit it answered nobody at all. Above the limit a
request is refused at once, before anything of it has run, and the web app tries it again."""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

HEALTH = "/api/health"


def limit_in_flight(limit: int) -> Callable[..., Awaitable[Response]]:
    # Middleware runs on the event loop: one thread, so a plain counter is safe.
    in_flight = 0

    async def middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        nonlocal in_flight
        path = request.url.path
        if not path.startswith("/api/") or path.startswith(HEALTH):
            return await call_next(request)
        if in_flight >= limit:
            return JSONResponse(
                status_code=503,
                content={"error": {"code": "server_busy", "message": "Try again in a moment"}},
                headers={"Retry-After": "2"},
            )
        in_flight += 1
        try:
            return await call_next(request)
        finally:
            in_flight -= 1

    return middleware
