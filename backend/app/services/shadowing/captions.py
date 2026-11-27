"""A YouTube video's English captions, fetched by the server with yt-dlp (ADR 0100).

Copying the text from YouTube's «Show transcript» panel was the one hard step of making an
exercise, so the server now fetches the captions itself when a link is checked. Only the captions'
text and times are fetched: no video, no audio. The owner accepted that this goes beyond what
YouTube's terms allow (27 November 2026).

Which captions: the channel's own English subtitles first, then YouTube's English speech
recognition. A machine translation into English is never taken: its words are not what is said.

Each video is fetched once and kept for everyone; a video without English captions is kept as
'none' for an hour before anyone tries again. YouTube refusing the server (its «Sign in to confirm
you're not a bot» comes and goes) is tried once more and never kept: the next ask tries again.
Pasting the text stays for when this finds nothing."""

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Any, NamedTuple

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import YouTubeTranscript
from app.services.shadowing.youtube import youtube_id_of

log = logging.getLogger(__name__)

RETRY_AFTER = timedelta(hours=1)
FETCH_TIMEOUT_S = 25.0
SOCKET_TIMEOUT_S = 10
# YouTube's refusals are often over a moment later.
ATTEMPTS = 2
RETRY_PAUSE_S = 2.0
# A video of several hours still fits, a word to a cue; beyond this the rest is left out.
MAX_CUES = 20_000
# A word with no end given lasts this long at most; a longer silence after it is a pause.
WORD_MS = 800
MAX_CUE_CHARS = 500
# At most this many fetches at once, so a crowd of new links can't tie the server up.
_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="captions")

Cue = dict[str, Any]


class Captions(NamedTuple):
    """What a video gives: whose captions, their cues, and, when the cues are the channel's own
    lines, YouTube's speech recognition word by word, so the device can put each of the channel's
    words on the time it is said (ADR 0100)."""

    kind: str
    cues: list[Cue]
    words: list[Cue] | None = None


# «[Music]», «♪»: sounds, not words to say (as the pasted text is cleaned on the device).
_SOUND = re.compile(r"\[[^\]]*\]|♪+")


def pick_track(info: dict[str, Any]) -> tuple[str, list[dict[str, Any]]] | None:
    """('manual' | 'auto', the track's formats); None when the video has no English of its own."""
    own = info.get("subtitles") or {}
    for key in ["en", *sorted(k for k in own if k.startswith("en-"))]:
        if own.get(key):
            return "manual", own[key]
    auto = info.get("automatic_captions") or {}
    if auto.get("en-orig"):
        return "auto", auto["en-orig"]
    # Without 'en-orig', automatic 'en' is the speech recognition only when the video is English;
    # otherwise it is a translation.
    if auto.get("en") and str(info.get("language") or "").startswith("en"):
        return "auto", auto["en"]
    return None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _SOUND.sub(" ", text)).strip()[:MAX_CUE_CHARS]


def cues_of(data: dict[str, Any]) -> list[Cue]:
    """YouTube's json3 captions as cues, each ending by the time the next begins. Speech
    recognition gives each word its own time: then each word is a cue, so a sentence starts and
    stops with its words, not with the caption line. The channel's own subtitles come by line."""
    cues: list[Cue] = []
    for event in data.get("events") or []:
        if event.get("aAppend") or not event.get("segs"):
            continue
        start = int(event.get("tStartMs") or 0)
        end = start + int(event.get("dDurationMs") or 0)
        segs = event["segs"]
        if len(segs) > 1 and any("tOffsetMs" in seg for seg in segs):
            times = [start + int(seg.get("tOffsetMs") or 0) for seg in segs]
            for seg, at, upto in zip(segs, times, [*times[1:], end], strict=True):
                for word in _clean(str(seg.get("utf8") or "")).split():
                    cues.append({"start_ms": at, "end_ms": min(upto, at + WORD_MS), "text": word})
            continue
        text = _clean("".join(str(seg.get("utf8") or "") for seg in segs))
        if text:
            cues.append({"start_ms": start, "end_ms": end, "text": text})
    cues.sort(key=lambda cue: cue["start_ms"])
    for cue, after in pairwise(cues):
        if after["start_ms"] > cue["start_ms"]:
            cue["end_ms"] = min(cue["end_ms"], after["start_ms"])
    for cue in cues:
        cue["end_ms"] = max(cue["end_ms"], cue["start_ms"] + 1)
    return cues[:MAX_CUES]


class _Quiet:
    def debug(self, msg: str) -> None:
        pass

    info = warning = debug

    def error(self, msg: str) -> None:
        log.info("yt-dlp: %s", msg)


def _json3(ydl: Any, formats: list[dict[str, Any]]) -> list[Cue]:
    url = next((f["url"] for f in formats if f.get("ext") == "json3" and f.get("url")), None)
    return cues_of(json.loads(ydl.urlopen(url).read())) if url else []


def download(video_id: str) -> Captions | None:
    """The video's captions from YouTube, or None when it has none. Raises when YouTube can't
    be asked (blocked, down, changed). The channel's own lines come with the speech recognition's
    words, when YouTube has them, for their times."""
    import yt_dlp  # Heavy to import, and only needed here.

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": SOCKET_TIMEOUT_S,
        "logger": _Quiet(),
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        picked = pick_track(info or {})
        if picked is None:
            return None
        kind, formats = picked
        cues = _json3(ydl, formats)
        words = None
        recognised = (info or {}).get("automatic_captions", {}).get("en-orig")
        if kind == "manual" and cues and recognised:
            try:
                words = _json3(ydl, recognised) or None
            except Exception as error:  # The lines alone still do, with their own times.
                log.info("speech recognition words for %s: %s", video_id, str(error)[:200])
    return Captions(kind, cues, words) if cues else None


def _download_patiently(video_id: str) -> Captions | None:
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return download(video_id)
        except Exception as error:
            log.warning("captions for %s, try %d: %s", video_id, attempt, str(error)[:300])
            if attempt == ATTEMPTS:
                raise
            time.sleep(RETRY_PAUSE_S)
    return None


def _keep(db: Session, video_id: str, found: Captions, now: datetime) -> None:
    values = {"kind": found.kind, "cues": found.cues, "words": found.words, "fetched_at": now}
    statement = insert(YouTubeTranscript).values(youtube_id=video_id, **values)
    db.execute(
        statement.on_conflict_do_update(index_elements=[YouTubeTranscript.youtube_id], set_=values)
    )
    db.commit()


def transcript(db: Session, video_id: str, now: datetime, fetch: bool) -> Captions:
    """The video's captions, fetched once for everyone. 404 'no_captions' when the video has none,
    503 'captions_refused' when YouTube would not answer now (asking again may work); either way the
    learner may paste the text. With `fetch` off, only what was already kept."""
    if youtube_id_of(video_id) != video_id:
        raise ApiError(422, "not_a_youtube_link", "Not a YouTube video id")
    kept = db.get(YouTubeTranscript, video_id)
    if not fetch and (kept is None or kept.kind == "none"):
        raise ApiError(404, "no_captions", "No captions found for this video")
    if kept is not None and kept.kind != "none":
        return Captions(kept.kind, kept.cues, kept.words)
    if kept is not None and now - kept.fetched_at < RETRY_AFTER:
        raise ApiError(404, "no_captions", "No captions found for this video")
    try:
        found = _pool.submit(_download_patiently, video_id).result(timeout=FETCH_TIMEOUT_S)
    except FutureTimeout as error:
        log.warning("captions for %s: timed out", video_id)
        raise ApiError(503, "captions_refused", "YouTube did not give the captions now") from error
    except Exception as error:  # yt-dlp raises many kinds; logged above. Not kept: may pass.
        raise ApiError(503, "captions_refused", "YouTube did not give the captions now") from error
    if found is None:
        _keep(db, video_id, Captions("none", []), now)
        raise ApiError(404, "no_captions", "No captions found for this video")
    captions = Captions(*found)
    _keep(db, video_id, captions, now)
    return captions
