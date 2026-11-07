"""What the server sends twice it sends small (performance, Nov 2026): compressed JSON and code,
built files kept for good, the glossary answered «not modified», and SQL counted per request."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.main import create_app
from app.models import GlossaryForm
from app.services import words


def test_the_glossary_is_tagged_and_not_sent_again(client: TestClient, db: Session) -> None:
    first = client.get("/api/glossary")
    assert first.status_code == 200
    tag = first.headers["etag"]
    assert first.json()["went"] == words.glossary(db)["went"].model_dump()
    again = client.get("/api/glossary", headers={"If-None-Match": tag})
    assert (again.status_code, again.content, again.headers["etag"]) == (304, b"", tag)

    # New content means a new tag, so nobody keeps an old glossary.
    db.add(GlossaryForm(form="zzzz", ru="тест", lemma="zzzz", note=None))
    db.commit()
    words.forget_glossary()
    changed = client.get("/api/glossary", headers={"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["etag"] != tag
    db.delete(db.get_one(GlossaryForm, "zzzz"))
    db.commit()
    words.forget_glossary()


def test_json_is_compressed_and_its_sql_counted(client: TestClient) -> None:
    response = client.get("/api/glossary", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    assert int(client.get("/api/me").headers["x-query-count"]) > 0


def test_built_files_are_kept_and_the_page_is_always_checked(tmp_path: Path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-AbC123.js").write_text("console.log(1)")
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "go.mp3").write_bytes(b"ID3")
    for name in ("index.html", "sw.js", "manifest-ru.webmanifest"):
        (tmp_path / name).write_text("x")
    settings = get_settings().model_copy(update={"web_dist": str(tmp_path)})
    web = TestClient(create_app(settings))
    expected = {
        "/assets/index-AbC123.js": "public, max-age=31536000, immutable",
        "/audio/go.mp3": "public, max-age=604800",
        "/sw.js": "no-cache",
        "/manifest-ru.webmanifest": "no-cache",
        "/": "no-cache",
        "/decks/anything": "no-cache",  # the app's own pages are index.html
    }
    for path, cache in expected.items():
        assert web.get(path).headers["cache-control"] == cache, path
