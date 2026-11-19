"""Speaking: session + audio upload + job queue + transcription pipeline."""

import io
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.services.speaking import jobs as jobs_svc
from app.services.speaking.fluency import compute_fluency
from app.services.speaking.fluency import meets_minimum_evidence as fluency_min
from app.services.speaking.grammar import GrammarError_, check_grammar
from app.services.speaking.grammar import meets_minimum_evidence as grammar_min
from app.services.speaking.pronunciation import (
    PhonemeScore,
    PronunciationResult,
    WordPronunciationScore,
    meets_minimum_evidence,
)
from app.services.speaking.transcription import TranscriptResult, TranscriptWord
from app.services.speaking.vocabulary import compute_vocabulary
from app.services.speaking.vocabulary import meets_minimum_evidence as vocab_min
from tests.speaking_audio import real_webm
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
    # A real WebM/Opus recording, so the worker's conversion for Azure runs as in production.
    return real_webm()


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


@pytest.mark.parametrize(
    ("duration_ms", "status"), [(180_000, 200), (186_000, 200), (200_000, 422)]
)
def test_a_three_minute_recording_is_accepted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, duration_ms: int, status: int
) -> None:
    # The recorder stops at 3:00: its upload must not be refused as too long (it was, above 2:10).
    _enable_speaking(monkeypatch)
    session_id = client.post(
        "/api/speaking/sessions",
        json={"exercise_type": "spontaneous", "question_id": "spon-films"},
        headers=as_("eve"),
    ).json()["id"]
    upload = client.post(
        f"/api/speaking/sessions/{session_id}/audio",
        files={"file": ("rec.webm", io.BytesIO(_webm()), "audio/webm;codecs=opus")},
        data={"duration_ms": str(duration_ms)},
        headers=as_("eve"),
    )
    assert upload.status_code == status, upload.text


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
    now = datetime.now(UTC)
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
    now = datetime.now(UTC)
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
    now = datetime.now(UTC)
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

    now = datetime.now(UTC)
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

    now = datetime.now(UTC)
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
        # A real WebM/Opus recording: the worker converts it for Azure, as in production.
        files={"file": ("rec.webm", io.BytesIO(real_webm()), "audio/webm;codecs=opus")},
        headers=as_(user),
    )
    assert upload.status_code == 200, upload.text
    return dict(upload.json())


def _make_pron_result(
    word_count: int = 12, duration_ms: int = 5000, completeness: float = 100.0
) -> PronunciationResult:
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
        completeness_score=completeness,
        pronunciation_score=83.0,
        words=words,
        raw={
            "recognition_status": "Success",
            "accuracy_score": 85.0,
            "fluency_score": 80.0,
            "completeness_score": completeness,
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

    now = datetime.now(UTC)
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
            "app.services.speaking.orchestration.assess_read_aloud", return_value=fake_pron
        ) as read_aloud,
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

    # Azure gets the sentence itself, and WAV 16 kHz mono, never the browser's WebM.
    wav, reference = read_aloud.call_args.args[:2]
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert reference == "The weather in November is cold and rainy."

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


def _run_read_aloud(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, user: str, fake_pron: PronunciationResult
) -> dict[str, object]:
    """A read-aloud session through the worker with Azure's answer faked; the session as read."""
    _enable_speaking(monkeypatch)
    session_id = _upload_pronunciation_session(client, user)["id"]
    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime.now(UTC)
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-worker", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-worker", now)
    assert job is not None
    db.commit()
    with (
        patch(
            "app.services.speaking.orchestration.transcribe",
            return_value=_make_transcript_result(word_count=8, duration_ms=3000),
        ),
        patch("app.services.speaking.orchestration.assess_read_aloud", return_value=fake_pron),
    ):
        orch.run_assess_job(
            db,
            get_storage(get_settings()),
            job,
            openai_api_key="fake-key",
            azure_speech_key="fake-azure-key",
            now=now,
        )
    db.close()
    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_(user))
    return dict(resp.json())


def test_read_aloud_short_sentence_is_scored(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """«The weather in November is cold and rainy.» is 8 words: read in full, it gets a score.

    The free-speech minimum (10 words) used to apply here too, so this sentence never could."""
    body = _run_read_aloud(client, monkeypatch, "igor", _make_pron_result(word_count=8))
    assert body["status"] == "done"
    assessment = body["assessment"]
    assert isinstance(assessment, dict)
    assert assessment["pronunciation_score"] == pytest.approx(83.0, abs=0.1)


def test_read_aloud_barely_read_gets_no_score(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Less than half the sentence read (Azure completeness < 50): words shown, no score."""
    body = _run_read_aloud(
        client, monkeypatch, "ilse", _make_pron_result(word_count=3, completeness=30.0)
    )
    assessment = body["assessment"]
    assert isinstance(assessment, dict)
    assert assessment["pronunciation_score"] is None
    assert len(assessment["pronunciation_words"]) == 3


def test_azure_pa_failure_is_nonfatal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Azure PA failure keeps the session done with a transcript but no pronunciation_score."""
    _enable_speaking(monkeypatch)
    result = _upload_pronunciation_session(client, "julia")
    session_id = result["id"]

    fake_transcript = _make_transcript_result(word_count=12, duration_ms=5000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.pronunciation import PronunciationError
    from app.services.speaking.storage import get_storage

    now = datetime.now(UTC)
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
            "app.services.speaking.orchestration.assess_read_aloud",
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
    """Too little free speech for a pronunciation score: Azure is not called (nor paid for)."""
    _enable_speaking(monkeypatch)
    result = _upload_session(client, "karl")
    session_id = result["id"]

    fake_transcript = _make_transcript_result(word_count=5, duration_ms=2000)

    from app.services.speaking import orchestration as orch
    from app.services.speaking.storage import get_storage

    now = datetime.now(UTC)
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
        patch("app.services.speaking.orchestration.assess_free_speech") as mock_assess,
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


# ─── Chunk 5: fluency + vocabulary + grammar + coherence ────────────────────


def _make_words(count: int, wpm: float = 120.0) -> list[TranscriptWord]:
    """Generate `count` evenly-spaced words at the given WPM."""
    ms_per_word = int(60_000 / wpm)
    words = []
    for i in range(count):
        start = i * ms_per_word
        end = start + max(1, ms_per_word - 50)
        words.append(TranscriptWord(word=f"word{i}", start_ms=start, end_ms=end, confidence=1.0))
    return words


def test_fluency_minimum_evidence_check() -> None:
    assert fluency_min(7, 5_000) is False  # too few words
    assert fluency_min(8, 3_999) is False  # too short
    assert fluency_min(8, 4_000) is True


def test_compute_fluency_basic() -> None:
    words = _make_words(30, wpm=120.0)
    duration_ms = int(30 / 120.0 * 60_000)
    result = compute_fluency(words, duration_ms)
    assert 110.0 <= result.wpm <= 130.0
    assert result.pause_ratio < 0.1
    assert result.score >= 90.0


def test_compute_fluency_slow_speaker() -> None:
    words = _make_words(20, wpm=50.0)
    duration_ms = int(20 / 50.0 * 60_000)
    result = compute_fluency(words, duration_ms)
    assert result.wpm < 90.0
    assert result.score < 100.0


def test_vocabulary_minimum_evidence_check() -> None:
    assert vocab_min(39) is False
    assert vocab_min(40) is True


def test_compute_vocabulary_basic() -> None:
    # Enough common English words to exceed the 30-word threshold.
    transcript = " ".join(["The dog runs fast and the cat jumps high"] * 5)
    result = compute_vocabulary(transcript)
    assert result.score is not None
    assert 0.0 <= result.score <= 100.0
    assert result.unique_lemmas > 0


def test_grammar_minimum_evidence_check() -> None:
    assert grammar_min(4) is False
    assert grammar_min(5) is True


def test_grammar_check_mocked_errors() -> None:
    """check_grammar parses LanguageTool JSON and computes a score."""
    lt_response = {
        "matches": [
            {
                "message": "Did you mean 'going'?",
                "offset": 4,
                "length": 5,
                "replacements": [{"value": "going"}],
                "rule": {"id": "GOING_TO", "category": {"id": "GRAMMAR"}},
            }
        ]
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = lt_response

    with patch("httpx2.post", return_value=mock_resp):
        result = check_grammar("She are going to school", "http://lt:8010", word_count=5)

    assert result.error_count == 1
    assert result.score < 100.0


def test_grammar_check_raises_on_connection_error() -> None:
    with (
        patch("httpx2.post", side_effect=OSError("Connection refused")),
        pytest.raises(GrammarError_) as exc_info,
    ):
        check_grammar("some text", "http://lt:8010", word_count=10)
    assert exc_info.value.code == "connection_error"


def test_worker_runs_full_pipeline(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fluency and vocabulary scores are written when pipeline has enough words."""
    import app.services.speaking.orchestration as orch
    from app.services.speaking.storage import get_storage

    _enable_speaking(monkeypatch)

    session_id = _upload_session(client, "karl")["id"]

    storage = get_storage(get_settings())

    now = datetime.now(UTC)
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-wfp", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-wfp", now)
    assert job is not None
    db.commit()

    # 40 evenly-spaced words, 20 seconds total → ~120 WPM, qualifies for fluency + vocabulary.
    words_40 = _make_words(40, wpm=120.0)
    duration_ms = int(40 / 120.0 * 60_000)
    fake_transcript = TranscriptResult(
        transcript=" ".join(w.word for w in words_40),
        words=words_40,
        duration_ms=duration_ms,
        raw={},
    )

    with patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            now=MOMENT,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("karl"))
    body = resp.json()
    assert body["status"] == "done"
    assert body["assessment"]["fluency_score"] is not None
    assert body["assessment"]["fluency_score"] > 0
    # vocabulary_score may be None if spaCy yields <30 recognisable content words from
    # synthetic "word0…word39" tokens — that's acceptable; we just check fluency here.


def test_grammar_skipped_when_no_url(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """grammar_score is null when language_tool_url is not configured."""
    import app.services.speaking.orchestration as orch

    _enable_speaking(monkeypatch)
    monkeypatch.setattr(get_settings(), "language_tool_url", None)

    session_id = _upload_session(client, "karl")["id"]

    from app.services.speaking.storage import get_storage as _get_storage

    storage = _get_storage(get_settings())

    now = datetime.now(UTC)
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-wgr", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-wgr", now)
    assert job is not None
    db.commit()

    words_40 = _make_words(40, wpm=120.0)
    duration_ms = int(40 / 120.0 * 60_000)
    fake_transcript = TranscriptResult(
        transcript=" ".join(w.word for w in words_40),
        words=words_40,
        duration_ms=duration_ms,
        raw={},
    )

    with patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            language_tool_url=None,
            now=now,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("karl"))
    body = resp.json()
    assert body["assessment"]["grammar_score"] is None


def test_coherence_skipped_when_no_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """coherence_score is null when assess_coherence raises (e.g. bad/missing key)."""
    import app.services.speaking.orchestration as orch
    from app.services.speaking.coherence import CoherenceError
    from app.services.speaking.storage import get_storage

    _enable_speaking(monkeypatch)

    session_id = _upload_session(client, "karl")["id"]

    storage = get_storage(get_settings())

    now = datetime.now(UTC)
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-wco", now)
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-wco", now)
    assert job is not None
    db.commit()

    words_40 = _make_words(40, wpm=120.0)
    duration_ms = int(40 / 120.0 * 60_000)
    fake_transcript = TranscriptResult(
        transcript=" ".join(w.word for w in words_40),
        words=words_40,
        duration_ms=duration_ms,
        raw={},
    )

    with (
        patch("app.services.speaking.orchestration.transcribe", return_value=fake_transcript),
        patch(
            "app.services.speaking.orchestration.assess_coherence",
            side_effect=CoherenceError("no_key", "no key"),
        ),
    ):
        orch.run_assess_job(
            db,
            storage,
            job,
            openai_api_key="fake-key",
            now=now,
        )
    db.close()

    resp = client.get(f"/api/speaking/sessions/{session_id}", headers=as_("karl"))
    body = resp.json()
    assert body["assessment"]["coherence_score"] is None


# ─── Speaking v2: what each kind of answer is scored on, and why a score is missing ─────────

ANSWER_B2 = (
    "If I were to describe my hometown, I'd say that it is easily one of the best places in the "
    "world. Well, obviously I'm biased because I was born there and I love my country and my "
    "city. I've got lots of relatives, friends and beloved people living there, so I appreciate "
    "it a lot. In the morning I usually try to wake up as early as possible, sometimes at four, "
    "but I rarely succeed in that, I have to admit. After waking up I warm my body up by doing "
    "some physical exercise, and then I have breakfast with my family before work."
)


def _words_of(text: str, wpm: float = 130.0) -> list[TranscriptWord]:
    step = int(60_000 / wpm)
    return [
        TranscriptWord(word=w, start_ms=i * step, end_ms=i * step + step - 60, confidence=1.0)
        for i, w in enumerate(text.split())
    ]


def _run_job(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    user: str,
    *,
    exercise: str = "spontaneous",
    transcript: str = ANSWER_B2,
    **patches: object,
) -> dict[str, object]:
    """One answer through the worker with Whisper (and anything in `patches`) faked."""
    import app.services.speaking.orchestration as orch
    from app.services.speaking.storage import get_storage

    _enable_speaking(monkeypatch)
    if exercise == "pronunciation":
        session_id = _upload_pronunciation_session(client, user)["id"]
    else:
        session_id = _upload_session(client, user)["id"]
    words = _words_of(transcript)
    fake = TranscriptResult(
        transcript=transcript, words=words, duration_ms=words[-1].end_ms + 200, raw={}
    )
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-v2", datetime.now(UTC))
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-v2", datetime.now(UTC))
    assert job is not None
    db.commit()
    with patch("app.services.speaking.orchestration.transcribe", return_value=fake):
        for name, value in patches.items():
            monkeypatch.setattr(orch, name, value)
        orch.run_assess_job(db, get_storage(get_settings()), job, openai_api_key=None, now=MOMENT)
    db.close()
    body = client.get(f"/api/speaking/sessions/{session_id}", headers=as_(user)).json()
    assert body["status"] == "done", body
    return dict(body["assessment"])


def test_a_free_answer_gets_a_vocabulary_score_with_its_profile(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = _run_job(client, monkeypatch, "vera")
    assert a["vocabulary_score"] is not None
    vocab = a["evidence"]["vocabulary"]  # type: ignore[index]
    assert set(vocab["profile"]) == {"A1-A2", "B1", "B2", "C1+"}
    assert 0 < vocab["mattr"] <= 1


def test_a_failing_vocabulary_scorer_says_so_instead_of_too_few_words(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Production recorded «insufficient_evidence» for 199-word answers: the spaCy model was
    missing and the error was swallowed. A failure must be reported as one."""

    def missing_model(_: str) -> object:
        raise OSError("[E050] Can't find model 'en_core_web_sm'")

    a = _run_job(client, monkeypatch, "viktor", compute_vocabulary=missing_model)
    assert a["vocabulary_score"] is None
    assert a["evidence"]["vocabulary"] == {"skipped": "error:OSError"}  # type: ignore[index]


def test_quoted_misuses_cost_a_little_and_are_kept_as_evidence(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.speaking.vocabulary_llm import validate

    plain = _run_job(client, monkeypatch, "wanda")
    evidence = validate(
        {
            "misused": [
                {"quote": "beloved people", "better": "loved ones", "why": "Natural phrase."}
            ]
        },
        ANSWER_B2,
    )
    import app.services.speaking.orchestration as orch

    monkeypatch.setattr(get_settings(), "openai_api_key", None)
    with patch.object(orch, "find_vocabulary_evidence", return_value=evidence):
        # The evidence call needs a key; give one only for this run.
        a = _run_job_with_key(client, monkeypatch, "walter")
    assert a["vocabulary_score"] == pytest.approx(plain["vocabulary_score"] - 3.0, abs=0.01)  # type: ignore[operator]
    stored = a["evidence"]["vocabulary"]  # type: ignore[index]
    assert stored["evidence"]["misused"][0]["better"] == "loved ones"
    assert stored["misuse_penalty"] == 3.0


def _run_job_with_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, user: str
) -> dict[str, object]:
    """As _run_job, with an OpenAI key, and grammar/coherence faked out (no network)."""
    import app.services.speaking.orchestration as orch
    from app.services.speaking.storage import get_storage

    _enable_speaking(monkeypatch)
    session_id = _upload_session(client, user)["id"]
    words = _words_of(ANSWER_B2)
    fake = TranscriptResult(
        transcript=ANSWER_B2, words=words, duration_ms=words[-1].end_ms + 200, raw={}
    )
    db: Session = get_sessionmaker()()
    job = jobs_svc.claim_one(db, "test-v2", datetime.now(UTC))
    while job is not None and str(job.session_id) != session_id:
        db.commit()
        job = jobs_svc.claim_one(db, "test-v2", datetime.now(UTC))
    assert job is not None
    db.commit()
    with (
        patch.object(orch, "transcribe", return_value=fake),
        patch.object(orch, "check_grammar_llm", side_effect=RuntimeError("offline")),
        patch.object(orch, "assess_coherence", side_effect=RuntimeError("offline")),
        patch.object(orch, "generate_feedback", side_effect=RuntimeError("offline")),
    ):
        orch.run_assess_job(db, get_storage(get_settings()), job, openai_api_key="k", now=MOMENT)
    db.close()
    return dict(
        client.get(f"/api/speaking/sessions/{session_id}", headers=as_(user)).json()["assessment"]
    )


def test_read_aloud_is_scored_on_pronunciation_and_fluency_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The words of a read-aloud sentence are ours: they say nothing about the learner's
    vocabulary, grammar or ideas."""
    a = _run_job(client, monkeypatch, "xenia", exercise="pronunciation", transcript=ANSWER_B2)
    for measure in ("vocabulary", "grammar", "coherence"):
        assert a[f"{measure}_score"] is None
        assert a["evidence"][measure] == {"skipped": "read_aloud"}  # type: ignore[index]


def test_fluency_evidence_lists_each_pause(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    answer = "I think that um the best place is Paris. Because it is very beautiful and calm."
    words = _words_of(answer, wpm=110)
    # A long pause after «best», inside a phrase.
    words = [
        TranscriptWord(
            w.word, w.start_ms + (900 if i > 5 else 0), w.end_ms + (900 if i > 5 else 0), 1
        )
        for i, w in enumerate(words)
    ]
    import app.services.speaking.orchestration as orch

    monkeypatch.setattr(orch, "fluency_min_evidence", lambda *_: True)
    from app.services.speaking.fluency import FluencyResult

    seen: dict[str, FluencyResult] = {}
    real = orch._fluency

    def spy(transcript: TranscriptResult, pron: object, wav: object) -> FluencyResult:
        t = TranscriptResult(transcript=answer, words=words, duration_ms=words[-1].end_ms, raw={})
        seen["r"] = real(t, None, None)
        return seen["r"]

    a = _run_job(client, monkeypatch, "yuri", transcript=answer, _fluency=spy)
    fluency = a["evidence"]["fluency"]  # type: ignore[index]
    assert fluency["filled_pauses"] == 1  # «um», from Whisper's own words
    places = {(p["before"], p["after"]) for p in fluency["pauses"]}
    assert ("best", "place") in places
    assert fluency["timing_source"] == "whisper"
