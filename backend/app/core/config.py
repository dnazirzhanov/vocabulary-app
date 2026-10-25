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
    # Only "dev" exists until a real auth provider is integrated (ADR 0004).
    auth_mode: Literal["dev"] = "dev"
    # Comma-separated origins for a deployed web app; empty in development (Vite proxies /api).
    allowed_origins: str = ""

    @field_validator("database_url")
    @classmethod
    def _postgres_only(cls, value: str) -> str:
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must be a postgresql+psycopg:// URL")
        return value

    @model_validator(mode="after")
    def _no_dev_auth_in_production(self) -> "Settings":
        if self.environment == "production" and self.auth_mode == "dev":
            raise ValueError(
                "AUTH_MODE=dev cannot run with ENVIRONMENT=production; "
                "real authentication arrives in Phase 4"
            )
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
