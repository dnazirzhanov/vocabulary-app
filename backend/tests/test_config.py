import pytest
from pydantic import ValidationError

from app.core.config import Settings

DB = "postgresql+psycopg://localhost/vocab_test"


def test_dev_auth_is_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="AUTH_MODE=dev cannot run"):
        Settings(environment="production", database_url=DB, auth_mode="dev", _env_file=None)


def test_only_postgres_urls_are_accepted() -> None:
    with pytest.raises(ValidationError, match="postgresql"):
        Settings(database_url="sqlite:///local.db", _env_file=None)


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = Settings(
        database_url=DB, allowed_origins=" https://a.example , https://b.example,", _env_file=None
    )
    assert settings.cors_origins == ["https://a.example", "https://b.example"]
