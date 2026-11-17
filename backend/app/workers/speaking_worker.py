"""Speaking pipeline worker.

Runs as a separate process on Fly machine #2 (Chunk 9 wires up the deployment).
For now: `uv run python -m app.workers.speaking_worker`

Poll loop:
  1. Claim one pending job (FOR UPDATE SKIP LOCKED).
  2. Run the appropriate handler.
  3. On success: commit done.
  4. On expected failure (TranscriptionError etc.): mark job for retry or terminal failure.
  5. On unexpected exception: same retry/fail logic, log the traceback.
"""

from __future__ import annotations

import logging
import signal
import time
from datetime import UTC, datetime

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_engine
from app.services.speaking import jobs as jobs_svc
from app.services.speaking.orchestration import run_assess_job
from app.services.speaking.storage import StorageClient, get_storage

log = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2.0
_running = True


def _handle_sigterm(signum: int, frame: object) -> None:
    global _running
    log.info("SIGTERM received; stopping after current job.")
    _running = False


def run_worker(poll_interval: float = POLL_INTERVAL_SECONDS) -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)
    settings = get_settings()
    engine = get_engine()
    storage = get_storage(settings)
    worker_id = settings.speaking_worker_id

    if not settings.openai_api_key:
        log.warning("OPENAI_API_KEY is not set; transcription jobs will fail immediately.")
    if not settings.azure_speech_key:
        log.warning("AZURE_SPEECH_KEY is not set; pronunciation assessments will be skipped.")
    if not settings.language_tool_url:
        log.info("LANGUAGE_TOOL_URL is not set; grammar scoring will be skipped.")
    if not settings.deepseek_api_key:
        log.info("DEEPSEEK_API_KEY is not set; coherence scoring will be skipped.")

    log.info("Speaking worker starting (id=%s)", worker_id)
    while _running:
        did_work = _process_one(
            engine,
            storage,
            worker_id,
            settings.openai_api_key or "",
            settings.azure_speech_key,
            settings.azure_speech_region,
            settings.language_tool_url,
            settings.deepseek_api_key,
            settings.deepseek_model,
        )
        if not did_work:
            time.sleep(poll_interval)


def _process_one(
    engine: Engine,
    storage: StorageClient,
    worker_id: str,
    openai_api_key: str,
    azure_speech_key: str | None,
    azure_speech_region: str,
    language_tool_url: str | None = None,
    deepseek_api_key: str | None = None,
    deepseek_model: str = "deepseek-chat",
) -> bool:
    """Claim and process one job. Returns True if a job was processed, False if queue was empty."""
    with Session(engine) as db:
        now = datetime.now(UTC)
        job = jobs_svc.claim_one(db, worker_id, now)
        if job is None:
            return False
        db.commit()  # Commit the claim before running the job.

        log.info(
            "Processing job %s kind=%s session=%s attempt=%d",
            job.id,
            job.kind,
            job.session_id,
            job.attempts,
        )
        try:
            if job.kind == "assess":
                run_assess_job(
                    db,
                    storage,
                    job,
                    openai_api_key=openai_api_key,
                    azure_speech_key=azure_speech_key,
                    azure_speech_region=azure_speech_region,
                    language_tool_url=language_tool_url,
                    deepseek_api_key=deepseek_api_key,
                    deepseek_model=deepseek_model,
                    now=now,
                )
            else:
                log.warning("Unknown job kind %s — marking done", job.kind)
                jobs_svc.complete(db, job)
                db.commit()
        except Exception as exc:
            log.exception("Job %s failed: %s", job.id, exc)
            with Session(engine) as err_db:
                err_job = err_db.get(type(job), job.id)
                if err_job is not None:
                    terminal = jobs_svc.record_failure(err_db, err_job, str(exc), datetime.now(UTC))
                    if terminal:
                        # Mark the session failed so the learner sees an error state.
                        from app.models.speaking import SpeakingSession

                        session = err_db.get(SpeakingSession, err_job.session_id)
                        if session and session.status not in ("done", "failed"):
                            session.status = "failed"
                            session.failure_reason = "worker_error"
                            session.completed_at = datetime.now(UTC)
                    err_db.commit()
        return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run_worker()
