import json
import logging
import sys
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response

from app.core.config import get_settings
from app.core.db import QueryCount, query_count

logger = logging.getLogger("app")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn's own access log would duplicate the request log below.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False
    # It logs every outgoing URL, and deleting a login's URL names that learner (ADR 0043).
    logging.getLogger("httpx2").setLevel(logging.WARNING)


async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """One line per request: method, path, status, duration, and the SQL it ran (statements and
    their time). Never bodies or headers."""
    started = time.perf_counter()
    counter = QueryCount()
    token = query_count.set(counter)
    try:
        response = await call_next(request)
    finally:
        query_count.reset(token)
    if get_settings().environment != "production":
        # For measuring screens and for tests; production keeps it in the log only.
        response.headers["X-Query-Count"] = str(counter.queries)
    logger.info(
        "request",
        extra={
            "fields": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "queries": counter.queries,
                "sql_ms": round(counter.seconds * 1000, 1),
            }
        },
    )
    return response
