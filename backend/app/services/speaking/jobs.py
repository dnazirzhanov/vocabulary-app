"""Postgres-backed job queue for the speaking pipeline.

Design: a single speaking_jobs row per (session, kind). The worker polls
  WHERE status='pending' AND not_before <= now() FOR UPDATE SKIP LOCKED
so multiple worker instances can run without coordination.

Backoff: each failure doubles the delay (30s × 2^attempts) with a cap of 10 min.
Terminal failure: after MAX_ATTEMPTS the job moves to 'failed' and the session
is marked failed so the learner can see a clear error.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.speaking import SpeakingJob

MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 30
_BACKOFF_CAP_SECONDS = 600


def enqueue(db: Session, session_id: uuid.UUID, kind: str) -> SpeakingJob | None:
    """Insert a new pending job. Returns None (silently) if a job of this kind already exists
    for the session — idempotent so a retried finalize call doesn't create duplicates.

    Uses a savepoint so a duplicate-key error only rolls back the job insert, not the
    surrounding transaction (audio asset + session update)."""
    job = SpeakingJob(
        session_id=session_id,
        kind=kind,
        status="pending",
        attempts=0,
    )
    db.add(job)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        return None
    return job


def claim_one(db: Session, worker_id: str, now: datetime) -> SpeakingJob | None:
    """Atomically claim one pending job. Returns None when the queue is empty.

    Uses FOR UPDATE SKIP LOCKED so concurrent workers don't block each other.
    The caller must commit after processing (or rollback on failure)."""
    job = db.scalar(
        select(SpeakingJob)
        .where(SpeakingJob.status == "pending")
        .where(SpeakingJob.not_before <= now)
        .order_by(SpeakingJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job is None:
        return None
    job.status = "claimed"
    job.claimed_at = now
    job.claimed_by = worker_id
    job.attempts += 1
    db.flush()
    return job


def complete(db: Session, job: SpeakingJob) -> None:
    job.status = "done"


def record_failure(
    db: Session,
    job: SpeakingJob,
    error: str,
    now: datetime,
) -> bool:
    """Mark this attempt as failed. Returns True if the job has permanently failed
    (reached MAX_ATTEMPTS), False if it was rescheduled for a retry."""
    job.last_error = error[:2000]
    if job.attempts >= MAX_ATTEMPTS:
        job.status = "failed"
        return True
    # Exponential backoff: 30s, 60s, 120s, … capped at 10 min.
    delay = min(_BACKOFF_BASE_SECONDS * (2 ** (job.attempts - 1)), _BACKOFF_CAP_SECONDS)
    job.status = "pending"
    job.not_before = now + timedelta(seconds=delay)
    job.claimed_at = None
    job.claimed_by = None
    return False


def by_session(db: Session, session_id: uuid.UUID, kind: str) -> SpeakingJob | None:
    return db.scalar(
        select(SpeakingJob)
        .where(SpeakingJob.session_id == session_id)
        .where(SpeakingJob.kind == kind)
    )
