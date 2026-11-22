"""Real recordings for the speaking tests, made once per run with ffmpeg (as browsers make them)."""

import functools
import subprocess


def _encode(seconds: float, args: list[str]) -> bytes:
    return subprocess.run(  # noqa: S603 - fixed arguments, no shell, test audio only
        [  # noqa: S607 - ffmpeg is found on PATH
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=220:sample_rate=48000:duration={seconds}",
            "-ac",
            "1",
            *args,
            "pipe:1",
        ],
        capture_output=True,
        check=True,
    ).stdout


@functools.cache
def real_webm(seconds: float = 2.0) -> bytes:
    """WebM/Opus at 48 kHz: what Chrome and the Android app's MediaRecorder produce."""
    return _encode(seconds, ["-c:a", "libopus", "-f", "webm"])


@functools.cache
def real_mp4(seconds: float = 2.0) -> bytes:
    """MP4/AAC: what Safari's MediaRecorder produces."""
    return _encode(seconds, ["-c:a", "aac", "-f", "ipod", "-movflags", "frag_keyframe+empty_moov"])
