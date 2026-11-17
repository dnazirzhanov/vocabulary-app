"""Speaking: session + audio upload + job queue + transcription pipeline."""

import io
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.services.speaking import jobs as jobs_svc
from app.services.speaking.pronunciation import (
    PhonemeScore,
    PronunciationResult,
    WordPronunciationScore,
    meets_minimum_evidence,
)
from app.services.speaking.transcription import TranscriptResult, TranscriptWord
from tests.support import at

MOMENT = datetime(2026, 11, 16, 15, 0, tzinfo=UTC)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def _enable_speaking(monkeypatch: pytest.MonkeyPatch, pattern: str = "*") -> None:
    """Enable Speaking for every user; also forces filesystem storage into a temp dir."""
    monkeypatch.setattr(get_settings(), "speaking_testers", pattern)
    # Isolate storage per test to avoid leaking recordings across runs.
    tmp = tempfile.mkdtemp(prefix="speaking-test-")
    monkeypatch.setattr(get_settings(), "speaking_storage_mode", "filesystem")
    monkeypatch.setattr(get_settings(), "speaking_audio_dir", tmp)


def _webm() -> bytes:
    # A short non-empty byte sequence; Chunk 2 doesn't probe content, only size + MIME.
    return b"\x1a\x45\xdf\xa3" + b"\x00" * 128


# ─── Access control ─────────────────────────────────────────────────────────────


def test_speaking_requires_tester_flag(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Someone who is not a tester must get 403 on every endpoint.
    monkeypatch.setattr(get_settings(), "speaking_testers", "e2e-speaking-*")
    headers = as_("alice")
    resp = client.get("/api/speaking/questions", headers=headers)
    assert resp.status_code == 403
    resp = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_me_reports_speaking_flag(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "speaking_testers", "*")
    monkeypatch.setattr(get_settings(), "mentor_testers", "e2e-mentor-*")
    monkeypatch.setattr(get_settings(), "reading_testers", "e2e-reader-*")
    me = client.get("/api/me", headers=as_("bob")).json()
    assert me["speaking"] is True
    assert me["mentor"] is False


# ─── Questions ──────────────────────────────────────────────────────────────────


def test_list_questions(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    resp = client.get("/api/speaking/questions", headers=as_("carol"))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 3
    ids = {q["id"] for q in data}
    assert "spon-films" in ids
    assert "pron-weather" in ids


def test_list_questions_filters_by_type(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    resp = client.get("/api/speaking/questions?exercise_type=pronunciation", headers=as_("carol"))
    assert resp.status_code == 200
    types = {q["exercise_type"] for q in resp.json()}
    assert types == {"pronunciation"}


# ─── Create session ─────────────────────────────────────────────────────────────


def test_create_session_ok(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    resp = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("dan"),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "created"
    assert body["exercise_type"] == "spontaneous"
    assert body["question_id"] == "spon-films"


def test_create_session_rejects_unknown_question(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    resp = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "no-such-id"},
        headers=as_("dan"),
    )
    assert resp.status_code == 404


def test_create_session_rejects_type_mismatch(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    # spon-films is a spontaneous question — can't create it as pronunciation.
    resp = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "pronunciation", "question_id": "spon-films"},
        headers=as_("dan"),
    )
    assert resp.status_code == 400


# ─── Upload audio ───────────────────────────────────────────────────────────────


def test_upload_audio_end_to_end(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    )
    session_id = create.json()["id"]

    upload = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm;codecs=opus")},
        data={"duration_ms": "12000", "sample_rate": "16000"},
        headers=as_("eve"),
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["status"] == "uploaded"
    assert body["audio"] is not None
    assert body["audio"]["mime_type"] == "audio/webm;codecs=opus"
    assert body["audio"]["duration_ms"] == 12000
    assert body["audio"]["sample_rate"] == 16000
    assert body["audio"]["byte_size"] > 0

    # The audio file should actually exist on the filesystem storage.
    storage_dir = Path(get_settings().speaking_audio_dir)
    files = list(storage_dir.rglob("*.webm"))
    assert len(files) == 1
    assert files[0].read_bytes() == _webm()


def test_upload_rejects_unsupported_mime(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    )
    session_id = create.json()["id"]
    resp = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.txt", io.BytesIO(b"hello"), "text/plain")},
        headers=as_("eve"),
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "unsupported_audio_mime"


def test_upload_rejects_oversize(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    monkeypatch.setattr(get_settings(), "speaking_max_audio_bytes", 100)
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    )
    session_id = create.json()["id"]
    resp = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(b"\x00" * 500), "audio/webm")},
        headers=as_("eve"),
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "audio_too_large"


def test_upload_rejects_empty(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    )
    session_id = create.json()["id"]
    resp = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(b""), "audio/webm")},
        headers=as_("eve"),
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "empty_audio"


def test_upload_is_single_shot(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A session's audio can be uploaded exactly once; a second upload is rejected."""
    _enable_speaking(monkeypatch)
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    )
    session_id = create.json()["id"]
    first = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("a.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_("eve"),
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("b.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_("eve"),
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "session_not_recordable"


# ─── Ownership ──────────────────────────────────────────────────────────────────


def test_cannot_read_other_users_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    created = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("fran"),
    )
    session_id = created.json()["id"]
    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("gus"))
    assert resp.status_code == 404  # 404, not 403 — do not leak existence


def test_cannot_upload_to_other_users_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    created = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("hank"),
    )
    session_id = created.json()["id"]
    resp = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_("ivy"),
    )
    assert resp.status_code == 404


def test_cannot_delete_other_users_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    created = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("jade"),
    )
    session_id = created.json()["id"]
    resp = client.delete(f"/api/speaking/sessions/{session_id}", headers=as_("kai"))
    assert resp.status_code == 404


# ─── Delete ─────────────────────────────────────────────────────────────────────


def test_delete_soft_deletes_and_removes_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    created = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("liam"),
    )
    session_id = created.json()["id"]
    client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_("liam"),
    )
    storage_dir = Path(get_settings().speaking_audio_dir)
    assert len(list(storage_dir.rglob("*.webm"))) == 1

    resp = client.delete(f"/api/speaking/sessions/{session_id}", headers=as_("liam"))
    assert resp.status_code == 204
    assert len(list(storage_dir.rglob("*.webm"))) == 0

    # The session still exists (audit trail), but with no audio and status=failed.
    after = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("liam"))
    assert after.status_code == 200
    assert after.json()["status"] == "failed"
    assert after.json()["audio"] is None


# ─── Rate limit ─────────────────────────────────────────────────────────────────


def test_session_create_rate_limited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    monkeypatch.setattr(get_settings(), "speaking_sessions_per_day", 2)
    for _ in range(2):
        resp = client.post(
            "/api/speaking/sessions",
            json={"exercise_type": "spontaneous", "question_id": "spon-films"},
            headers=as_("quinn"),
        )
        assert resp.status_code == 200
    third = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("quinn"),
    )
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "speaking_session_limit"


# ─── Chunk 3: job queue + transcription ──────────────────────────────────────────


def _upload_session(client: TestClient, user: str = "alex") -> dict[str, object]:
    """Helper: create a session and upload audio. Returns the response body."""
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_(user),
    )
    assert create.status_code == 200, create.text
    session_id = create.json()["id"]
    upload = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_(user),
    )
    assert upload.status_code == 200, upload.text
    return dict(upload.json())


def test_upload_enqueues_assess_job(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "alex")
    session_id = str(result["id"])
    assert result["status"] == "uploaded"

    db: Session = get_sessionmaker()()
    job = jobs_svc.by_session(db, uuid.UUID(session_id), "assess")
    db.close()
    assert job is not None
    assert job.status == "pending"
    assert job.attempts == 0


def test_job_claim_one(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "beth")
    session_id = result["id"]

    db: Session = get_sessionmaker()()
    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    job = jobs_svc.claim_one(db, "test-worker", now)
    # There may be jobs from other tests; find ours.
    claimed = None
    while job is not None:
        if str(job.session_id) == session_id:
            claimed = job
            break
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    db.close()

    assert claimed is not None
    assert claimed.status == "claimed"
    assert claimed.claimed_by == "test-worker"
    assert claimed.attempts == 1


def test_job_complete(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "cleo")
    session_id = result["id"]

    db: Session = get_sessionmaker()()
    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    jobs_svc.complete(db, job)
    db.commit()
    db.refresh(job)
    assert job.status == "done"
    db.close()


def test_job_retry_on_failure(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "dana")
    session_id = result["id"]

    db: Session = get_sessionmaker()()
    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None

    terminal = jobs_svc.record_failure(db, job, "boom", now)
    db.commit()
    assert not terminal
    assert job.status == "pending"
    assert job.attempts == 1
    assert job.not_before > now
    db.close()


def test_job_terminal_failure_after_max_attempts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "evan")
    session_id = str(result["id"])

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()

    # Look up without claiming so the loop can claim it MAX_ATTEMPTS times.
    job = jobs_svc.by_session(db, uuid.UUID(session_id), "assess")
    assert job is not None

    terminal = False
    for _ in range(jobs_svc.MAX_ATTEMPTS):
        # Reset not_before so claim_one can pick it up without waiting for backoff.
        job.not_before = now
        db.commit()
        claimed = jobs_svc.claim_one(db, "test-worker", now)
        # Drain any jobs from earlier tests that may be ahead in the queue.
        while claimed is not None and claimed.id != job.id:
            jobs_svc.complete(db, claimed)
            db.commit()
            claimed = jobs_svc.claim_one(db, "test-worker", now)
        assert claimed is not None, f"Job {job.id} disappeared from queue"
        terminal = jobs_svc.record_failure(db, claimed, "repeated error", now)
        db.commit()

    db.close()
    assert terminal


def test_worker_runs_transcription(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Worker processes an assess job with a mocked Whisper call and writes the assessment."""
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "faye")
    session_id = result["id"]

    fake_result = TranscriptResult(
        transcript="I really like action films.",
        words=[
            TranscriptWord("I", 0, 200, 0.99),
            TranscriptWord("really", 200, 500, 0.98),
            TranscriptWord("like", 500, 800, 0.97),
            TranscriptWord("action", 800, 1200, 0.96),
            TranscriptWord("films", 1200, 1600, 0.95),
        ],
        duration_ms=1800,
        raw={"model": "whisper-1", "language": "en", "duration_s": 1.8, "word_count": 5},
    )

    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()
    storage = get_storage(get_settings())
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()

    with patch("app.services.speaking.orchestration.transcribe", return_value=fake_result):
        orch.run_assess_job(db, storage, job, openai_api_key="fake-key", now=now)

    db.refresh(job)
    assert job.status == "done"

    # Session should be 'done' and assessment should exist.
    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("faye"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"] is not None
    assert body["assessment"]["transcript"] == "I really like action films."
    assert len(body["assessment"]["transcript_words"]) == 5
    db.close()


def test_session_shows_no_assessment_while_processing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "gray")
    session_id = result["id"]
    # Immediately after upload: assessment is null, status is 'uploaded'.
    assert result["assessment"] is None
    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("gray"))
    assert resp.status_code == 200
    assert resp.json()["assessment"] is None


# ─── Chunk 4: pronunciation pipeline ────────────────────────────────────────────


def _upload_pronunciation_session(client: TestClient, user: str) -> dict[str, object]:
    """Create + upload audio for a pronunciation exercise. Returns response body."""
    create = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "pronunciation", "question_id": "pron-weather"},
        headers=as_(user),
    )
    assert create.status_code == 200, create.text
    session_id = create.json()["id"]
    upload = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm")},
        headers=as_(user),
    )
    assert upload.status_code == 200, upload.text
    return dict(upload.json())


def _make_pron_result(word_count: int = 12, duration_ms: int = 5000) -> PronunciationResult:
    """Return a fake PronunciationResult with configurable evidence thresholds."""
    words = [
        WordPronunciationScore(
            word=f"word{i}",
            accuracy_score=85.0,
            error_type="None",
            phonemes=[PhonemeScore(phoneme="AH", accuracy_score=90.0)],
        )
        for i in range(word_count)
    ]
    return PronunciationResult(
        accuracy_score=85.0,
        fluency_score=80.0,
        completeness_score=100.0,
        pronunciation_score=83.0,
        words=words,
        raw={
            "recognition_status": "Success",
            "accuracy_score": 85.0,
            "fluency_score": 80.0,
            "completeness_score": 100.0,
            "pronunciation_score": 83.0,
            "word_count": word_count,
        },
    )


def _make_transcript_result(word_count: int = 12, duration_ms: int = 5000) -> TranscriptResult:
    words = [
        TranscriptWord(word=f"word{i}", start_ms=i * 400, end_ms=i * 400 + 350, confidence=0.95)
        for i in range(word_count)
    ]
    return TranscriptResult(
        transcript=" ".join(w.word for w in words),
        words=words,
        duration_ms=duration_ms,
        raw={"model": "whisper-1", "language": "en", "duration_s": duration_ms / 1000},
    )


def test_minimum_evidence_check() -> None:
    """meets_minimum_evidence enforces ≥10 words AND ≥3 s before scoring."""
    assert meets_minimum_evidence(10, 3000)
    assert meets_minimum_evidence(15, 5000)
    assert not meets_minimum_evidence(9, 5000)
    assert not meets_minimum_evidence(10, 2999)
    assert not meets_minimum_evidence(0, 0)


def test_pronunciation_pipeline_writes_pron_score(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Worker stores pronunciation_score when Azure PA succeeds and evidence ≥ minimum."""
    _enable_speaking(monkeypatch)
    result = _upload_pronunciation_session(client, "hana")
    session_id = result["id"]

    fake_transcript = _make_transcript_result(word_count=12, duration_ms=5000)
    fake_pron = _make_pron_result(word_count=12, duration_ms=5000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()
    storage = get_storage(get_settings())
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()

    with (
        patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript),
        patch("app.services.speaking.orchestration.assess", return_value=fake_pron),
    ):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            azure_speech_key="fake-azure-key",
            now=now,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("hana"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"]["pronunciation_score"] == pytest.approx(83.0, abs=0.1)
    # Word-level breakdown should be present.
    words = body["assessment"]["pronunciation_words"]
    assert len(words) == 12
    assert words[0]["accuracy_score"] == pytest.approx(85.0, abs=0.1)
    assert words[0]["phonemes"][0]["phoneme"] == "AH"


def test_pronunciation_pipeline_no_score_below_evidence(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """pronunciation_score stays null when word count is below the minimum."""
    _enable_speaking(monkeypatch)
    result = _upload_pronunciation_session(client, "igor")
    session_id = result["id"]

    # Only 5 words — below the 10-word minimum.
    fake_transcript = _make_transcript_result(word_count=5, duration_ms=5000)
    fake_pron = _make_pron_result(word_count=5, duration_ms=5000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()
    storage = get_storage(get_settings())
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()

    with (
        patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript),
        patch("app.services.speaking.orchestration.assess", return_value=fake_pron),
    ):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            azure_speech_key="fake-azure-key",
            now=now,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("igor"))
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"]["pronunciation_score"] is None


def test_azure_pa_failure_is_nonfatal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Azure PA failure keeps the session done with a transcript but no pronunciation_score."""
    _enable_speaking(monkeypatch)
    result = _upload_pronunciation_session(client, "julia")
    session_id = result["id"]

    fake_transcript = _make_transcript_result(word_count=12, duration_ms=5000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.pronunciation import PronunciationError
    from app.services.speaking.storage import get_storage

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()
    storage = get_storage(get_settings())
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()

    with (
        patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript),
        patch(
            "app.services.speaking.orchestration.assess",
            side_effect=PronunciationError("rate_limited", "Azure rate limited"),
        ),
    ):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            azure_speech_key="fake-azure-key",
            now=now,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("julia"))
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"]["transcript"] is not None
    assert body["assessment"]["pronunciation_score"] is None
    assert body["assessment"]["pronunciation_words"] == []


def test_spontaneous_skips_azure_pa(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Spontaneous sessions do not call Azure PA even when a key is configured."""
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "karl")
    session_id = result["id"]

    fake_transcript = _make_transcript_result(word_count=5, duration_ms=2000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    db: Session = get_sessionmaker()()
    storage = get_storage(get_settings())
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()

    with (
        patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript),
        patch("app.services.speaking.orchestration.assess") as mock_assess,
    ):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            azure_speech_key="fake-azure-key",
            now=now,
        )
    mock_assess.assert_not_called()
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("karl"))
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"]["pronunciation_score"] is None
