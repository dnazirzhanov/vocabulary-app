"""Shadowing exercise queries and YAML loader."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.shadowing import ShadowingExercise

if TYPE_CHECKING:
    from app.services.speaking.storage import StorageClient


def list_active(db: Session) -> list[ShadowingExercise]:
    return list(
        db.scalars(
            select(ShadowingExercise)
            .where(ShadowingExercise.is_active == True)  # noqa: E712
            .order_by(ShadowingExercise.display_order, ShadowingExercise.created_at)
        )
    )


def by_id(db: Session, exercise_id: uuid.UUID) -> ShadowingExercise | None:
    return db.get(ShadowingExercise, exercise_id)


def load_from_yaml(db: Session, storage: StorageClient, dir_path: Path) -> int:
    """Upsert exercises from `exercises.yaml` and upload audio files. Returns count upserted."""
    yaml_path = dir_path / "exercises.yaml"
    audio_dir = dir_path / "audio"
    data: list[dict[str, Any]] = yaml.safe_load(yaml_path.read_text())
    count = 0
    for i, item in enumerate(data):
        slug = item["slug"]
        existing = db.scalar(select(ShadowingExercise).where(ShadowingExercise.slug == slug))

        audio_filename: str = item.get("audio_filename", f"{slug}.webm")
        audio_file = audio_dir / audio_filename
        mime = "audio/webm" if audio_filename.endswith(".webm") else "audio/mpeg"
        storage_path = f"exercises/{audio_filename}"

        if audio_file.exists():
            import asyncio

            asyncio.run(storage.upload(storage_path, audio_file.read_bytes(), mime))

        if existing:
            existing.title = item["title"]
            existing.description = item.get("description", "")
            existing.difficulty = item["difficulty"]
            existing.duration_ms = item["duration_ms"]
            existing.transcript = item.get("transcript", "")
            existing.sentences = item.get("sentences", [])
            existing.speaker = item.get("speaker")
            existing.audio_path = storage_path if audio_file.exists() else existing.audio_path
            existing.audio_mime_type = mime
            existing.display_order = i
            existing.is_active = True
        else:
            db.add(
                ShadowingExercise(
                    slug=slug,
                    title=item["title"],
                    description=item.get("description", ""),
                    difficulty=item["difficulty"],
                    duration_ms=item["duration_ms"],
                    transcript=item.get("transcript", ""),
                    sentences=item.get("sentences", []),
                    speaker=item.get("speaker"),
                    audio_path=storage_path if audio_file.exists() else "",
                    audio_mime_type=mime,
                    display_order=i,
                )
            )
        count += 1

    # Deactivate any exercise whose slug is no longer in the YAML.
    active_slugs = {item["slug"] for item in data}
    # Only curated ones: learners' own (ADR 0097) are never touched, and this runs every deploy.
    for ex in db.scalars(select(ShadowingExercise).where(ShadowingExercise.created_by.is_(None))):
        if ex.slug not in active_slugs:
            ex.is_active = False

    db.commit()
    return count
