"""Shadowing exercises from a YouTube video (ADR 0097).

YouTube's terms allow its own visible player and nothing else: no downloading, no audio apart from
the video. So an exercise keeps only the video's id, the chosen part and the sentences with their
times; the learner's device plays the video in YouTube's player. The text is the video's own
captions, fetched by the server (ADR 0100, `captions.py`), or else what the learner pasted from
YouTube's «Show transcript» panel; the device splits it into sentences.

Each learner makes their own; curated exercises (no owner) are everyone's, and a group's task may
link one, which opens it for the group's members (ADR 0096)."""

import re
import uuid
from datetime import datetime

import httpx2
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import ShadowingExercise, User
from app.schemas.shadowing import ExerciseIn, ExercisePatch, SentenceIn, YouTubeVideoOut

OEMBED = "https://www.youtube.com/oembed"
OEMBED_TIMEOUT_S = 5.0
MAX_OWN = 50
MAX_CLIP_MS = 10 * 60 * 1000

_ID = r"([A-Za-z0-9_-]{11})"
_PATTERNS = [
    re.compile(r"^(?:https?://)?(?:www\.|m\.|music\.)?youtu\.be/" + _ID),
    re.compile(
        r"^(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)/"
        r"(?:shorts/|embed/|live/|v/)" + _ID
    ),
    re.compile(r"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v=" + _ID),
]


def youtube_id_of(url: str) -> str | None:
    """The video's id from any usual link form, or None."""
    text = url.strip()
    if re.fullmatch(_ID, text):
        return text
    for pattern in _PATTERNS:
        found = pattern.match(text)
        if found:
            return found.group(1)
    return None


def check(url: str) -> YouTubeVideoOut:
    """The video, if YouTube's player may show it here: oEmbed answers only for a public video
    that allows embedding."""
    video_id = youtube_id_of(url)
    if video_id is None:
        raise ApiError(422, "not_a_youtube_link", "Not a YouTube link")
    try:
        response = httpx2.get(
            OEMBED,
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=OEMBED_TIMEOUT_S,
        )
    except httpx2.HTTPError as error:
        raise ApiError(503, "youtube_unreachable", "YouTube did not answer") from error
    if response.status_code != 200:
        raise ApiError(404, "video_unavailable", "The video is private, gone or not embeddable")
    data = response.json()
    return YouTubeVideoOut(
        youtube_id=video_id,
        title=str(data.get("title") or "")[:256],
        author=str(data.get("author_name") or "")[:128],
        thumbnail_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    )


def _checked_sentences(
    sentences: list[SentenceIn], clip_start_ms: int, clip_end_ms: int
) -> list[dict[str, int | str]]:
    if clip_end_ms <= clip_start_ms or clip_end_ms - clip_start_ms > MAX_CLIP_MS:
        raise ApiError(422, "clip_too_long", "The part must be up to 10 minutes")
    previous = clip_start_ms
    out: list[dict[str, int | str]] = []
    for sentence in sentences:
        if sentence.start_ms < previous or sentence.end_ms <= sentence.start_ms:
            raise ApiError(422, "invalid_sentences", "Sentences must follow one another")
        if sentence.end_ms > clip_end_ms:
            raise ApiError(422, "invalid_sentences", "A sentence is outside the part")
        out.append(
            {"start_ms": sentence.start_ms, "end_ms": sentence.end_ms, "text": sentence.text}
        )
        previous = sentence.end_ms
    return out


def create(db: Session, user: User, body: ExerciseIn, now: datetime) -> ShadowingExercise:
    own = db.scalar(
        select(func.count())
        .select_from(ShadowingExercise)
        .where(ShadowingExercise.created_by == user.id, ShadowingExercise.is_active.is_(True))
    )
    if (own or 0) >= MAX_OWN:
        raise ApiError(409, "too_many_exercises", "At most 50 exercises of your own")
    if youtube_id_of(body.youtube_id) != body.youtube_id:
        raise ApiError(422, "not_a_youtube_link", "Not a YouTube video id")
    sentences = _checked_sentences(body.sentences, body.clip_start_ms, body.clip_end_ms)
    exercise = ShadowingExercise(
        slug=f"yt-{body.youtube_id}-{uuid.uuid4().hex[:8]}",
        title=body.title,
        description="",
        difficulty=body.difficulty,
        language="en",
        duration_ms=body.clip_end_ms - body.clip_start_ms,
        transcript=" ".join(str(s["text"]) for s in sentences),
        sentences=sentences,
        speaker=body.author or None,
        audio_path="",
        audio_mime_type="",
        display_order=0,
        is_active=True,
        created_at=now,
        source="youtube",
        youtube_id=body.youtube_id,
        clip_start_ms=body.clip_start_ms,
        clip_end_ms=body.clip_end_ms,
        thumbnail_url=f"https://i.ytimg.com/vi/{body.youtube_id}/hqdefault.jpg",
        created_by=user.id,
    )
    db.add(exercise)
    db.commit()
    return exercise


def _own(db: Session, user: User, exercise_id: uuid.UUID) -> ShadowingExercise:
    exercise = db.get(ShadowingExercise, exercise_id)
    if exercise is None or not exercise.is_active:
        raise ApiError(404, "exercise_not_found", "Exercise not found")
    if exercise.created_by != user.id:
        raise ApiError(403, "not_owner", "Only its owner can change it")
    return exercise


def update(
    db: Session, user: User, exercise_id: uuid.UUID, body: ExercisePatch
) -> ShadowingExercise:
    exercise = _own(db, user, exercise_id)
    if body.title is not None:
        exercise.title = body.title
    if body.difficulty is not None:
        exercise.difficulty = body.difficulty
    if body.sentences is not None:
        start = body.clip_start_ms if body.clip_start_ms is not None else exercise.clip_start_ms
        end = body.clip_end_ms if body.clip_end_ms is not None else exercise.clip_end_ms
        sentences = _checked_sentences(body.sentences, start or 0, end or 0)
        exercise.sentences = sentences
        exercise.transcript = " ".join(str(s["text"]) for s in sentences)
        exercise.clip_start_ms, exercise.clip_end_ms = start, end
        exercise.duration_ms = (end or 0) - (start or 0)
    db.commit()
    return exercise


def remove(db: Session, user: User, exercise_id: uuid.UUID) -> None:
    """Put away, not erased: a group's task that links it still says what it was."""
    exercise = _own(db, user, exercise_id)
    exercise.is_active = False
    db.commit()


def visible(db: Session, user: User) -> list[ShadowingExercise]:
    """Curated ones, my own, and those my groups' tasks link (ADR 0096)."""
    # Here, not at the top: task_links imports the groups' services.
    from app.services import task_links

    linked: list[uuid.UUID] = []
    for ref in task_links.linked_refs(db, user, "shadowing"):
        try:
            linked.append(uuid.UUID(ref))
        except ValueError:
            continue
    return list(
        db.scalars(
            select(ShadowingExercise)
            .where(
                ShadowingExercise.is_active.is_(True),
                or_(
                    ShadowingExercise.created_by.is_(None),
                    ShadowingExercise.created_by == user.id,
                    ShadowingExercise.id.in_(linked),
                ),
            )
            .order_by(
                ShadowingExercise.created_by.is_(None),
                ShadowingExercise.display_order,
                ShadowingExercise.created_at.desc(),
            )
        )
    )


def may_open(db: Session, user: User, exercise: ShadowingExercise) -> bool:
    if exercise.created_by is None or exercise.created_by == user.id:
        return True
    from app.services import task_links

    return str(exercise.id) in task_links.linked_refs(db, user, "shadowing")
