from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Validated configuration. Environment variables win over the repo-root .env file."""

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str
    # "dev": local development users (ADR 0004). "jwt": Supabase-issued tokens (ADR 0009).
    auth_mode: Literal["dev", "jwt"] = "dev"
    # jwt mode: the token issuer, e.g. https://<project>.supabase.co/auth/v1
    auth_issuer: str | None = None
    auth_audience: str = "authenticated"
    # Comma-separated origins for a deployed web app; empty when the API serves the web app itself.
    allowed_origins: str = ""
    # Built web app (web/dist) to serve from the API in production; unset in development.
    web_dist: str | None = None
    # Answer submissions allowed per learner per minute (in-process limit; one instance).
    attempts_per_minute: int = 120
    # Drafting a deck from a teacher's text (ADR 0018): "claude" needs ANTHROPIC_API_KEY; "demo"
    # makes placeholder cards without any service; "auto" is claude with a key, else demo outside
    # production (production without a key has no generation).
    generation_provider: Literal["auto", "claude", "demo"] = "auto"
    anthropic_api_key: str | None = None
    # Drafts per teacher per day: each costs a model call.
    generations_per_day: int = 20

    @field_validator("database_url")
    @classmethod
    def _postgres_only(cls, value: str) -> str:
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must be a postgresql+psycopg:// URL")
        return value

    @model_validator(mode="after")
    def _auth_is_complete(self) -> "Settings":
        if self.environment == "production" and self.auth_mode == "dev":
            raise ValueError(
                "AUTH_MODE=dev cannot run with ENVIRONMENT=production; use AUTH_MODE=jwt"
            )
        if self.auth_mode == "jwt":
            if not self.auth_issuer or not self.auth_issuer.startswith("https://"):
                raise ValueError("AUTH_MODE=jwt needs AUTH_ISSUER (an https:// URL)")
            self.auth_issuer = self.auth_issuer.rstrip("/")
        return self

    @property
    def jwks_url(self) -> str:
        """Public signing keys of the issuer (Supabase serves them under the issuer URL)."""
        assert self.auth_issuer is not None
        return f"{self.auth_issuer}/.well-known/jwks.json"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
