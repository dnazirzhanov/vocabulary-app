from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import Response

from app.api import decks, group_tests, groups, health, learning, me, push, sync
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, log_requests
from app.core.overload import limit_in_flight


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    public_docs = settings.environment != "production"
    app = FastAPI(
        title="Vocabulary API",
        docs_url="/api/docs" if public_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if public_docs else None,
    )
    app.middleware("http")(limit_in_flight(settings.max_requests_in_flight))
    app.middleware("http")(log_requests)
    # JSON and the app's code shrink to a fifth or less; audio and fonts are left as they are.
    # Level 5: most of the saving for much less of the server's CPU than the default 9.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            # Everything the web app sends: the Android app (Capacitor, https://localhost) is
            # another origin, so each method and header must be allowed here.
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "Authorization", "X-Time-Zone", "If-None-Match"],
            expose_headers=["X-Server-Time", "ETag"],
        )
    register_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(learning.router, prefix="/api")
    app.include_router(me.router, prefix="/api")
    app.include_router(groups.router, prefix="/api")
    app.include_router(group_tests.router, prefix="/api")
    app.include_router(decks.router, prefix="/api")
    app.include_router(push.router, prefix="/api")
    app.include_router(sync.router, prefix="/api")
    if settings.web_dist:
        _serve_web_app(app, Path(settings.web_dist))
    return app


# How long a browser may keep a file without asking again. Built files carry a hash of their
# content in the name, so they never change; recorded audio changes only when regenerated. The
# rest (the page itself, the service worker, manifests, OCR files) is checked on every visit, and
# comes back as "not modified" when it hasn't changed.
FOREVER = "public, max-age=31536000, immutable"
A_WEEK = "public, max-age=604800"
ALWAYS_CHECK = "no-cache"


class _HashedFiles(StaticFiles):
    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = FOREVER
        return response


def _serve_web_app(app: FastAPI, dist: Path) -> None:
    """Production: the API serves the built web app, so there is one origin and no CORS."""
    root = dist.resolve()
    app.mount("/assets", _HashedFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            cache = A_WEEK if path.startswith(("audio/", "icons/")) else ALWAYS_CHECK
            return FileResponse(candidate, headers={"Cache-Control": cache})
        # Every other path is the single-page app; never cache it, so deploys show up at once.
        return FileResponse(root / "index.html", headers={"Cache-Control": ALWAYS_CHECK})


app = create_app()
