from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import health, learning, me
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, log_requests


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
    app.middleware("http")(log_requests)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "Authorization"],
            expose_headers=["X-Server-Time"],
        )
    register_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(learning.router, prefix="/api")
    app.include_router(me.router, prefix="/api")
    if settings.web_dist:
        _serve_web_app(app, Path(settings.web_dist))
    return app


def _serve_web_app(app: FastAPI, dist: Path) -> None:
    """Production: the API serves the built web app, so there is one origin and no CORS."""
    root = dist.resolve()
    app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        # Every other path is the single-page app; never cache it, so deploys show up at once.
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})


app = create_app()
