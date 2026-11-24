from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
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
    # jwt mode: Supabase's secret key, only to delete a login with its account (ADR 0043). It can
    # manage every login, so it lives in the host's secrets and never reaches the browser.
    supabase_secret_key: SecretStr | None = None
    # Comma-separated origins for a deployed web app; empty when the API serves the web app itself.
    allowed_origins: str = ""
    # Built web app (web/dist) to serve from the API in production; unset in development.
    web_dist: str | None = None
    # Requests worked on at once; more are refused for the web app to retry (ADR 0044). Measured at
    # 0.1 CPU: with 12, too many were turned away at 30 students; without a limit, 60 got nothing.
    max_requests_in_flight: int = 20
    # Answer submissions allowed per learner per minute (in-process limit; one instance).
    attempts_per_minute: int = 120
    # Drafting a deck from a teacher's text (ADR 0018): "deepseek" needs DEEPSEEK_API_KEY; "demo"
    # makes placeholder cards without any service; "auto" is deepseek with a key, else demo outside
    # production (production without a key has no generation).
    generation_provider: Literal["auto", "deepseek", "demo"] = "auto"
    deepseek_api_key: str | None = None
    # deepseek-flash (fast, cheap) or deepseek-v4-pro (stronger), as DeepSeek names them today.
    deepseek_model: str = "deepseek-flash"
    # Drafts per teacher per day: each costs a model call.
    generations_per_day: int = 20
    # Deadline reminders by Web Push (ADR 0031). VAPID keys identify this server to the browsers'
    # push services: `uv run python -m app.cli vapid-keys` makes a pair. Without them there are no
    # reminders. The subject is a contact for the push services (mailto: or https:).
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:reminders@localhost"
    # The secret an hourly scheduler sends to POST /api/internal/reminders; unset: no endpoint.
    reminders_token: str | None = None
    # Sign-ins (auth subjects, comma-separated) who read reports on the course's cards.
    content_editors: str = ""
    # Sign-ins (auth subjects or bare UIDs, comma-separated) who see Reading Mode (an experiment).
    reading_testers: str = ""
    # Sign-ins (same format) who see the Mentor tab: translations and polish before rollout.
    mentor_testers: str = ""
    # The Mentor tab itself (ADR 0084): hidden for everyone since «Планы» took its place; its
    # code, data and API stay, and this brings the tab back. The e2e server turns it on.
    mentor_tab: bool = False
    # Sign-ins (same format) who see the Writing tab; empty: nobody.
    writing_testers: str = ""
    # Mentor chat messages per user per day: each costs a model call.
    mentor_chats_per_day: int = 20
    # Set to true in e2e tests (via MENTOR_CHAT_DEMO=true) to force demo replies without a key.
    mentor_chat_demo: bool = False
    # Milliseconds between words when streaming a demo reply; set to 0 in tests for instant output.
    mentor_demo_stream_delay_ms: int = 50
    # Sampling temperature for the mentor LLM (0–2); lower = more deterministic.
    mentor_temperature: float = 0.7
    # Hard token ceiling per mentor reply; keeps costs predictable.
    mentor_max_tokens: int = 512
    # Sign-ins (same format) who see the Speaking tab: pronunciation + assessment, pre-rollout.
    speaking_testers: str = ""
    # Speaking sessions per learner per day (Chunk 2: upload-only; limit guards storage cost).
    speaking_sessions_per_day: int = 10
    # Max audio bytes per recording accepted by the upload endpoint; 10 MB covers ~2 min opus.
    speaking_max_audio_bytes: int = 10 * 1024 * 1024
    # Audio storage: 'filesystem' (dev/tests, writes to speaking_audio_dir) or 'supabase'.
    speaking_storage_mode: Literal["filesystem", "supabase"] = "filesystem"
    # Where FileSystemStorage writes; absolute or relative to the backend's working directory.
    speaking_audio_dir: str = "./.speaking-audio"
    # Supabase project base URL (e.g. https://<project>.supabase.co); used by SupabaseStorage.
    supabase_url: str | None = None
    # Supabase private bucket for speaking audio. Must exist before the feature can upload.
    speaking_audio_bucket: str = "speaking-audio"
    # OpenAI API key for Whisper transcription (Chunk 3+). Separate from deepseek_api_key.
    openai_api_key: str | None = None
    # Azure AI Speech key for Pronunciation Assessment (Chunk 4+). EU endpoint only.
    azure_speech_key: str | None = None
    # Azure region for pronunciation assessment. Must be an EU region (GDPR requirement).
    azure_speech_region: str = "westeurope"
    # New words and examples one learner may have spoken per day (each one a paid call, ADR 0070).
    pronunciations_per_day: int = 500
    # Identifier for the speaking worker instance; used in claimed_by for observability.
    speaking_worker_id: str = "default"
    # LanguageTool REST API base URL (Chunk 5). Optional — grammar_score stays null if unset.
    # Point to a self-hosted instance (e.g. http://languagetool:8010) in production.
    language_tool_url: str | None = None

    # Writing: AI evaluations per learner per day (each one is a paid model call).
    writing_submissions_per_day: int = 30
    # The longest answer accepted, in characters (about 1,000 words): bounds the cost of one call.
    writing_max_answer_chars: int = 6000

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
            if self.environment == "production" and self.supabase_secret_key is None:
                raise ValueError("AUTH_MODE=jwt in production needs SUPABASE_SECRET_KEY")
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
