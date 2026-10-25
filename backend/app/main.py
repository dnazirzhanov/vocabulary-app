from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, learning
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, log_requests


def create_app() -> FastAPI:
    settings = get_settings()
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
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "Authorization"],
            expose_headers=["X-Server-Time"],
        )
    register_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(learning.router, prefix="/api")
    return app


app = create_app()
