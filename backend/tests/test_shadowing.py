"""Shadowing: exercise list, attempt lifecycle, audio upload, and edge cases."""

import tempfile
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models.shadowing import ShadowingExercise
from tests.support import at

MOMENT = datetime(2026, 11, 18, 10, 0, tzinfo=UTC)


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def _use_filesystem_storage(monkeypatch: pytest.MonkeyPatch) -> str:
    tmp = tempfile.mkdtemp(prefix="shadowing-test-")
    monkeypatch.setattr(get_settings(), "speaking_storage_mode", "filesystem")
    monkeypatch.setattr(get_settings(), "speaking_audio_dir", tmp)
    return tmp


def _seed_exercise(
    slug: str = "test-exercise",
    *,
    is_active: bool = True,
    has_audio: bool = False,
) -> ShadowingExercise:
    db_factory = get_sessionmaker()
    with db_factory() as db:
        ex = ShadowingExercise(
            slug=slug,
            title="Test Exercise",
            description="A test shadowing exercise.",
            difficulty="beginner",
            duration_ms=15000,
            transcript="Hello world.",
            sentences=[{"start_ms": 0, "end_ms": 2000, "text": "Hello world."}],
            audio_path="exercises/test.webm" if has_audio else "",
            is_active=is_active,
        )
        db.add(ex)
        db.commit()
        db.refresh(ex)
        return ex


def _webm() -> bytes:
    return b"\x1a\x45\xdf\xa3" + b"\x00" * 128


# ─── Exercise list ──────────────────────────────────────────────────────────────


def test_list_exercises_empty(client: TestClient) -> None:
    resp = client.get("/api/shadowing/exercises", headers=as_("alice"))
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_exercises_returns_active(client: TestClient) -> None:
    _seed_exercise("morning-routine")
    resp = client.get("/api/shadowing/exercises", headers=as_("alice"))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["slug"] == "morning-routine"
    assert data[0]["has_audio"] is False
    assert data[0]["difficulty"] == "beginner"


def test_inactive_exercises_not_listed(client: TestClient) -> None:
    _seed_exercise("inactive-ex", is_active=False)
    resp = client.get("/api/shadowing/exercises", headers=as_("alice"))
    # Inactive exercises must not appear in the list.
    slugs = [e["slug"] for e in resp.json()]
    assert "inactive-ex" not in slugs


def test_exercise_includes_sentences(client: TestClient) -> None:
    _seed_exercise("with-sentences")
    data = client.get("/api/shadowing/exercises", headers=as_("alice")).json()
    ex = next(d for d in data if d["slug"] == "with-sentences")
    assert ex["sentences"] == [{"start_ms": 0, "end_ms": 2000, "text": "Hello world."}]


# ─── Exercise audio ─────────────────────────────────────────────────────────────


def test_exercise_audio_missing_path_returns_404(client: TestClient) -> None:
    ex = _seed_exercise("no-audio")
    resp = client.get(f"/api/shadowing/exercises/{ex.id}/audio", headers=as_("alice"))
    assert resp.status_code == 404


def test_exercise_audio_streams_from_filesystem(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("has-audio", has_audio=True)
    # Write a fake audio file into storage before fetching.
    from pathlib import Path

    audio_dir = Path(get_settings().speaking_audio_dir)
    (audio_dir / "exercises").mkdir(parents=True, exist_ok=True)
    (audio_dir / "exercises" / "test.webm").write_bytes(_webm())

    resp = client.get(f"/api/shadowing/exercises/{ex.id}/audio", headers=as_("alice"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/")


def test_exercise_audio_unknown_exercise_returns_404(client: TestClient) -> None:
    resp = client.get(f"/api/shadowing/exercises/{uuid.uuid4()}/audio", headers=as_("alice"))
    assert resp.status_code == 404


# ─── Attempt lifecycle ──────────────────────────────────────────────────────────


def test_create_attempt_unknown_exercise(client: TestClient) -> None:
    resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(uuid.uuid4())},
        headers=as_("alice"),
    )
    assert resp.status_code == 404


def test_create_attempt_inactive_exercise(client: TestClient) -> None:
    ex = _seed_exercise("inactive-for-attempt", is_active=False)
    resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    assert resp.status_code == 404


def test_create_attempt_success(client: TestClient) -> None:
    ex = _seed_exercise("day-at-work")
    resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["exercise_id"] == str(ex.id)
    assert body["completed_at"] is None


def test_upload_audio_and_complete(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("travelling")

    attempt_resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("bob"),
    )
    assert attempt_resp.status_code == 200
    attempt_id = attempt_resp.json()["id"]

    audio_resp = client.post(
        f"/api/shadowing/attempts/{attempt_id}/audio",
        files={"file": ("recording.webm", _webm(), "audio/webm")},
        data={"duration_ms": "5000"},
        headers=as_("bob"),
    )
    assert audio_resp.status_code == 200
    assert audio_resp.json()["duration_ms"] == 5000

    complete_resp = client.post(
        f"/api/shadowing/attempts/{attempt_id}/complete",
        headers=as_("bob"),
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["completed_at"] is not None


def test_upload_too_large_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_filesystem_storage(monkeypatch)
    # Shrink the limit to 10 bytes so our test blob exceeds it without allocating megabytes.
    monkeypatch.setattr(get_settings(), "speaking_max_audio_bytes", 10)
    ex = _seed_exercise("size-test")

    attempt_resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    attempt_id = attempt_resp.json()["id"]

    resp = client.post(
        f"/api/shadowing/attempts/{attempt_id}/audio",
        files={"file": ("recording.webm", _webm(), "audio/webm")},
        headers=as_("alice"),
    )
    assert resp.status_code == 413


def test_cannot_access_other_users_attempt(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("education")

    attempt_resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    attempt_id = attempt_resp.json()["id"]

    # Bob cannot upload to Alice's attempt.
    resp = client.post(
        f"/api/shadowing/attempts/{attempt_id}/audio",
        files={"file": ("recording.webm", _webm(), "audio/webm")},
        headers=as_("bob"),
    )
    assert resp.status_code == 404


def test_cannot_complete_other_users_attempt(client: TestClient) -> None:
    ex = _seed_exercise("edu2")
    attempt_resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    attempt_id = attempt_resp.json()["id"]

    resp = client.post(f"/api/shadowing/attempts/{attempt_id}/complete", headers=as_("bob"))
    assert resp.status_code == 404


def test_attempt_audio_requires_upload_first(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("edu3")
    attempt_resp = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("alice"),
    )
    attempt_id = attempt_resp.json()["id"]

    # Fetching audio before it has been uploaded must return 404.
    resp = client.get(f"/api/shadowing/attempts/{attempt_id}/audio", headers=as_("alice"))
    assert resp.status_code == 404


# ─── Exercise status / completion counts ────────────────────────────────────────


def test_exercise_attempts_status(client: TestClient) -> None:
    ex = _seed_exercise("technology")

    # No attempts yet.
    status_resp = client.get(
        f"/api/shadowing/exercises/{ex.id}/attempts",
        headers=as_("carol"),
    )
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["attempts_count"] == 0
    assert body["completed_count"] == 0

    # One incomplete attempt.
    client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("carol"),
    )

    status2 = client.get(
        f"/api/shadowing/exercises/{ex.id}/attempts",
        headers=as_("carol"),
    ).json()
    assert status2["attempts_count"] == 1
    assert status2["completed_count"] == 0


def test_completed_attempt_counts(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("psychology")

    # Create + upload + complete one attempt.
    attempt_id = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("dave"),
    ).json()["id"]

    client.post(
        f"/api/shadowing/attempts/{attempt_id}/audio",
        files={"file": ("r.webm", _webm(), "audio/webm")},
        headers=as_("dave"),
    )
    client.post(f"/api/shadowing/attempts/{attempt_id}/complete", headers=as_("dave"))

    status = client.get(
        f"/api/shadowing/exercises/{ex.id}/attempts",
        headers=as_("dave"),
    ).json()
    assert status["attempts_count"] == 1
    assert status["completed_count"] == 1


def test_completed_count_isolated_per_user(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_filesystem_storage(monkeypatch)
    ex = _seed_exercise("history")

    # Dave completes an attempt; Eve creates one but does not complete.
    dave_id = client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("dave"),
    ).json()["id"]
    client.post(
        f"/api/shadowing/attempts/{dave_id}/audio",
        files={"file": ("r.webm", _webm(), "audio/webm")},
        headers=as_("dave"),
    )
    client.post(f"/api/shadowing/attempts/{dave_id}/complete", headers=as_("dave"))
    client.post(
        "/api/shadowing/attempts",
        json={"exercise_id": str(ex.id)},
        headers=as_("eve"),
    )

    dave_status = client.get(
        f"/api/shadowing/exercises/{ex.id}/attempts", headers=as_("dave")
    ).json()
    eve_status = client.get(f"/api/shadowing/exercises/{ex.id}/attempts", headers=as_("eve")).json()

    assert dave_status["completed_count"] == 1
    assert eve_status["completed_count"] == 0
    # Dave's status is unaffected by Eve's attempt and vice-versa.
    assert dave_status["attempts_count"] == 1
    assert eve_status["attempts_count"] == 1
