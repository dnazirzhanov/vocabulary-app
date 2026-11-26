"""Shadowing from a YouTube video (ADR 0097): the link is checked with YouTube's oEmbed, a learner
makes their own exercise from the pasted text, and only they (and a group whose task links it) see
it. Nothing of the video is stored but its id and the sentences' times."""

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.shadowing import exercises as exercises_svc
from app.services.shadowing.youtube import youtube_id_of
from tests.support import at, named

MOMENT = datetime(2026, 11, 26, 10, 0, tzinfo=UTC)
VIDEO = "dQw4w9WgXcQ"


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


@pytest.mark.parametrize(
    "url",
    [
        VIDEO,
        f"https://www.youtube.com/watch?v={VIDEO}",
        f"https://youtube.com/watch?feature=share&v={VIDEO}&t=42s",
        f"https://m.youtube.com/watch?v={VIDEO}",
        f"https://youtu.be/{VIDEO}?si=abc",
        f"youtu.be/{VIDEO}",
        f"https://www.youtube.com/shorts/{VIDEO}",
        f"https://www.youtube.com/embed/{VIDEO}?start=3",
        f"https://www.youtube-nocookie.com/embed/{VIDEO}",
        f"https://www.youtube.com/live/{VIDEO}",
        f"  https://music.youtube.com/watch?v={VIDEO}&list=x  ",
    ],
)
def test_every_usual_link_gives_the_video(url: str) -> None:
    assert youtube_id_of(url) == VIDEO


@pytest.mark.parametrize(
    "url",
    [
        "https://vimeo.com/12345",
        "https://www.youtube.com/watch?v=short",
        "https://evil.example/youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/@channel",
        "",
    ],
)
def test_other_links_are_not_videos(url: str) -> None:
    assert youtube_id_of(url) is None


class FakeResponse:
    def __init__(self, status: int, body: dict[str, Any] | None = None) -> None:
        self.status_code = status
        self._body = body or {}

    def json(self) -> dict[str, Any]:
        return self._body


def oembed(
    monkeypatch: pytest.MonkeyPatch, answer: FakeResponse | Exception
) -> list[dict[str, Any]]:
    asked: list[dict[str, Any]] = []

    def fake(url: str, **kwargs: Any) -> FakeResponse:
        asked.append({"url": url, **kwargs})
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(httpx2, "get", fake)
    return asked


def test_a_link_is_checked_with_youtube(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked = oembed(
        monkeypatch, FakeResponse(200, {"title": "Daily English", "author_name": "Teacher"})
    )
    got = client.post(
        "/api/shadowing/youtube/check",
        json={"url": f"https://youtu.be/{VIDEO}"},
        headers=as_("masha"),
    )
    assert got.status_code == 200, got.text
    assert got.json() == {
        "youtube_id": VIDEO,
        "title": "Daily English",
        "author": "Teacher",
        "thumbnail_url": f"https://i.ytimg.com/vi/{VIDEO}/hqdefault.jpg",
    }
    # Only the public video's address goes to YouTube, nothing about the learner.
    assert asked[0]["params"]["url"] == f"https://www.youtube.com/watch?v={VIDEO}"
    assert asked[0]["timeout"] <= 5


@pytest.mark.parametrize(
    ("answer", "status", "code"),
    [
        (FakeResponse(401), 404, "video_unavailable"),  # embedding turned off
        (FakeResponse(404), 404, "video_unavailable"),  # private or gone
        (httpx2.ConnectTimeout("slow"), 503, "youtube_unreachable"),
    ],
)
def test_a_video_youtube_wont_show_is_refused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    answer: FakeResponse | Exception,
    status: int,
    code: str,
) -> None:
    oembed(monkeypatch, answer)
    got = client.post("/api/shadowing/youtube/check", json={"url": VIDEO}, headers=as_("masha"))
    assert got.status_code == status
    assert got.json()["error"]["code"] == code


def test_not_a_link_is_refused_without_asking_youtube(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked = oembed(monkeypatch, FakeResponse(200))
    got = client.post(
        "/api/shadowing/youtube/check", json={"url": "https://vimeo.com/1"}, headers=as_("masha")
    )
    assert got.status_code == 422 and got.json()["error"]["code"] == "not_a_youtube_link"
    assert asked == []


def body(**change: Any) -> dict[str, Any]:
    made: dict[str, Any] = {
        "youtube_id": VIDEO,
        "title": "Daily English",
        "author": "Teacher",
        "difficulty": "beginner",
        "clip_start_ms": 60_000,
        "clip_end_ms": 72_000,
        "sentences": [
            {"start_ms": 60_000, "end_ms": 64_000, "text": "Good morning, everyone."},
            {"start_ms": 64_000, "end_ms": 72_000, "text": "Today we talk about food."},
        ],
    }
    return made | change


def make(client: TestClient, who: str, **change: Any) -> Any:
    return client.post("/api/shadowing/exercises", json=body(**change), headers=as_(who))


def listed(client: TestClient, who: str) -> list[dict[str, Any]]:
    got = client.get("/api/shadowing/exercises", headers=as_(who))
    assert got.status_code == 200, got.text
    result: list[dict[str, Any]] = got.json()
    return result


def test_a_learner_makes_their_own_exercise_and_only_they_see_it(client: TestClient) -> None:
    made = make(client, "masha")
    assert made.status_code == 201, made.text
    exercise = made.json()
    assert exercise["source"] == "youtube" and exercise["youtube_id"] == VIDEO
    assert (exercise["clip_start_ms"], exercise["clip_end_ms"], exercise["duration_ms"]) == (
        60_000,
        72_000,
        12_000,
    )
    assert exercise["transcript"] == "Good morning, everyone. Today we talk about food."
    assert exercise["mine"] is True and exercise["has_audio"] is False
    assert [e["id"] for e in listed(client, "masha")] == [exercise["id"]]
    # Another learner sees nothing of it, and can't start it.
    assert listed(client, "petya") == []
    started = client.post(
        "/api/shadowing/attempts", json={"exercise_id": exercise["id"]}, headers=as_("petya")
    )
    assert started.status_code == 404
    mine = client.post(
        "/api/shadowing/attempts", json={"exercise_id": exercise["id"]}, headers=as_("masha")
    )
    assert mine.status_code == 200


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"clip_end_ms": 60_000}, "clip_too_long"),
        ({"clip_end_ms": 60_000 + 10 * 60_000 + 1}, "clip_too_long"),
        (
            {
                "sentences": [
                    {"start_ms": 64_000, "end_ms": 66_000, "text": "Second."},
                    {"start_ms": 60_000, "end_ms": 62_000, "text": "First."},
                ]
            },
            "invalid_sentences",
        ),
        (
            {"sentences": [{"start_ms": 59_000, "end_ms": 61_000, "text": "Early."}]},
            "invalid_sentences",
        ),
        (
            {"sentences": [{"start_ms": 70_000, "end_ms": 80_000, "text": "Late."}]},
            "invalid_sentences",
        ),
        (
            {"sentences": [{"start_ms": 61_000, "end_ms": 61_000, "text": "Empty."}]},
            "invalid_sentences",
        ),
        ({"youtube_id": "not/a/video"}, "not_a_youtube_link"),
    ],
)
def test_wrong_parts_and_sentences_are_refused(
    client: TestClient, change: dict[str, Any], code: str
) -> None:
    made = make(client, "masha", **change)
    assert made.status_code == 422, made.text
    assert made.json()["error"]["code"] == code


def test_empty_or_endless_text_is_refused(client: TestClient) -> None:
    assert make(client, "masha", sentences=[]).status_code == 422
    long = [{"start_ms": 60_000, "end_ms": 61_000, "text": "x" * 301}]
    assert make(client, "masha", sentences=long).status_code == 422
    assert make(client, "masha", title="  ").status_code == 422


def test_at_most_fifty_of_ones_own(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.shadowing import youtube

    monkeypatch.setattr(youtube, "MAX_OWN", 2)
    assert make(client, "masha").status_code == 201
    second = make(client, "masha")
    assert second.status_code == 201
    third = make(client, "masha")
    assert third.status_code == 409 and third.json()["error"]["code"] == "too_many_exercises"
    # One put away makes room again.
    client.delete(f"/api/shadowing/exercises/{second.json()['id']}", headers=as_("masha"))
    assert make(client, "masha").status_code == 201


def test_only_its_owner_changes_or_removes_it(client: TestClient) -> None:
    exercise = make(client, "masha").json()
    path = f"/api/shadowing/exercises/{exercise['id']}"
    assert client.patch(path, json={"title": "Mine"}, headers=as_("petya")).status_code == 403
    assert client.delete(path, headers=as_("petya")).status_code == 403
    changed = client.patch(
        path,
        json={
            "title": "Food talk",
            "difficulty": "intermediate",
            "sentences": [
                {"start_ms": 64_000, "end_ms": 72_000, "text": "Today we talk about food."}
            ],
        },
        headers=as_("masha"),
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["title"] == "Food talk"
    assert changed.json()["difficulty"] == "intermediate"
    assert changed.json()["transcript"] == "Today we talk about food."
    assert client.delete(path, headers=as_("masha")).status_code == 204
    assert listed(client, "masha") == []


def test_a_group_task_linking_it_opens_it_for_the_members(client: TestClient) -> None:
    exercise = make(client, "olga").json()
    group = client.post(
        "/api/groups", json={"name": "7Б"}, headers=named(client, as_("olga"), "Ольга")
    ).json()
    client.post(
        f"/api/groups/join/{group['invite_code']}", headers=named(client, as_("masha"), "Маша")
    )
    assert listed(client, "masha") == []
    task = client.post(
        f"/api/groups/{group['id']}/tasks",
        json={
            "title": "Шэдоуинг",
            "due_on": date(2026, 11, 27).isoformat(),
            "link": {"kind": "shadowing", "ref": exercise["id"]},
        },
        headers=as_("olga"),
    )
    assert task.status_code == 201, task.text
    seen = listed(client, "masha")
    assert [e["id"] for e in seen] == [exercise["id"]] and seen[0]["mine"] is False
    started = client.post(
        "/api/shadowing/attempts", json={"exercise_id": exercise["id"]}, headers=as_("masha")
    )
    assert started.status_code == 200
    # A stranger still sees nothing.
    assert listed(client, "petya") == []


def test_loading_the_curated_ones_leaves_learners_own_alone(
    client: TestClient, db: Session, tmp_path: Path
) -> None:
    exercise = make(client, "masha").json()
    (tmp_path / "exercises.yaml").write_text(
        "- slug: anna\n  title: Anna\n  difficulty: beginner\n  duration_ms: 1000\n"
    )
    exercises_svc.load_from_yaml(db, object(), tmp_path)  # type: ignore[arg-type]
    ids = [e["id"] for e in listed(client, "masha")]
    assert exercise["id"] in ids
    assert len(ids) == 2  # her own, and the curated one everyone sees
