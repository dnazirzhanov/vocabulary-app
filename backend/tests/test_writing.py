"""Writing: topics and questions, submitting for feedback, malformed or failed evaluations,
duplicates, persistence, and ownership. The model is never called: `evaluator._ask` is replaced."""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.errors import ApiError
from app.services.writing import evaluator
from app.services.writing import questions as bank
from app.services.writing.schema import ModelEvaluation, clean
from tests.support import at

MOMENT = datetime(2026, 11, 18, 10, 0, tzinfo=UTC)
ANSWER = "I no have car. I go to university by bus."


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


def criteria(score: int = 3) -> dict[str, Any]:
    return {
        name: {"score": score, "comment": "ok"}
        for name in ("task", "organization", "vocabulary", "grammar", "mechanics")
    }


def reply(**changes: Any) -> str:
    data: dict[str, Any] = {
        "enough_evidence": True,
        "cefr_level": "A2",
        "criteria": criteria(),
        "summary": "A clear short answer.",
        "strengths": [{"point": "Clear routine", "quote": "I go to university by bus"}],
        "improvements": ["Check negatives"],
        "corrections": [
            {
                "original": "I no have car",
                "corrected": "I don't have a car",
                "explanation": "Use don't.",
                "type": "grammar",
            }
        ],
        "vocabulary": [],
        "improved_version": "I don't have a car. I go to university by bus.",
    }
    data.update(changes)
    return json.dumps(data)


class Model:
    """A stand-in for the model: returns what it is told, and counts its calls."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.answers: list[str | ApiError] = [reply()]
        self.calls = 0
        self.last_user = ""
        monkeypatch.setattr(evaluator, "_ask", self._ask)

    def _ask(self, system: str, user: str, settings: object) -> str:
        self.calls += 1
        self.last_user = user
        item = self.answers[min(self.calls - 1, len(self.answers) - 1)]
        if isinstance(item, ApiError):
            raise item
        return item


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> Model:
    return Model(monkeypatch)


def post(
    client: TestClient, who: str = "ann", client_id: uuid.UUID | None = None, **fields: Any
) -> Any:
    body = {
        "client_id": str(client_id or uuid.uuid4()),
        "question_id": "life-morning",
        "answer": ANSWER,
    } | fields
    return client.post("/api/writing/submissions", json=body, headers=as_(who))


# -- topics and questions ------------------------------------------------------------------------


def test_topics_list_every_topic_with_its_count(client: TestClient) -> None:
    got = client.get("/api/writing/topics", headers=as_("ann")).json()
    assert [t["topic"] for t in got][:3] == ["Everyday Life", "Education", "Technology"]
    assert len(got) == 8
    assert all(t["question_count"] >= 3 for t in got)


def test_questions_of_one_topic(client: TestClient) -> None:
    got = client.get("/api/writing/questions?topic=Technology", headers=as_("ann")).json()
    assert got and {q["topic"] for q in got} == {"Technology"}
    assert {"id", "title", "instruction", "level", "suggested_minutes"} <= set(got[0])


def test_unknown_topic_is_404(client: TestClient) -> None:
    r = client.get("/api/writing/questions?topic=Nope", headers=as_("ann"))
    assert r.status_code == 404


def test_question_ids_are_unique() -> None:
    ids = [q.id for q in bank.QUESTIONS]
    assert len(ids) == len(set(ids))


# -- submitting ----------------------------------------------------------------------------------


def test_a_successful_submission_returns_checked_feedback(client: TestClient, model: Model) -> None:
    r = post(client, time_spent_seconds=95)
    assert r.status_code == 200
    got = r.json()
    assert got["status"] == "done"
    assert got["time_spent_seconds"] == 95
    assert got["evaluation"]["overall"] == 3
    assert got["question"]["title"] == "Describe a typical day in your life."
    assert got["evaluation"]["corrections"][0]["corrected"] == "I don't have a car"
    assert got["evaluation"]["strengths"][0]["quote"] == "I go to university by bus"
    # The question and the answer reached the model, fenced as text to assess.
    assert "Describe a typical day" in model.last_user and "<<<ANSWER" in model.last_user


def test_without_the_timer_no_time_is_recorded(client: TestClient, model: Model) -> None:
    assert post(client).json()["time_spent_seconds"] is None


@pytest.mark.parametrize("answer", ["", "   ", "\n\t "])
def test_an_empty_answer_is_refused_and_the_model_not_called(
    client: TestClient, model: Model, answer: str
) -> None:
    assert post(client, answer=answer).status_code == 422
    assert model.calls == 0


def test_a_too_long_answer_is_refused(
    client: TestClient, model: Model, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "writing_max_answer_chars", 20)
    assert post(client).json()["error"]["code"] == "answer_too_long"
    assert model.calls == 0


def test_an_unknown_question_is_404(client: TestClient, model: Model) -> None:
    assert post(client, question_id="nope").json()["error"]["code"] == "unknown_question"


def test_invented_mistakes_are_dropped(client: TestClient, model: Model) -> None:
    fake = {
        "original": "I never wrote this",
        "corrected": "x",
        "explanation": "y",
        "type": "grammar",
    }
    same = {"original": "I go", "corrected": "I go", "explanation": "y", "type": "grammar"}
    real = json.loads(reply())["corrections"][0]
    model.answers = [reply(corrections=[fake, same, real])]
    got = post(client).json()["evaluation"]["corrections"]
    assert [c["original"] for c in got] == ["I no have car"]


def test_an_invented_quote_is_dropped_but_the_praise_stays(
    client: TestClient, model: Model
) -> None:
    model.answers = [reply(strengths=[{"point": "Nice", "quote": "words not in the answer"}])]
    got = post(client).json()["evaluation"]["strengths"]
    assert got == [{"point": "Nice", "quote": None}]


def test_too_many_items_are_cut_not_rejected(client: TestClient, model: Model) -> None:
    model.answers = [reply(improvements=[f"tip {i}" for i in range(9)])]
    assert len(post(client).json()["evaluation"]["improvements"]) == 4


def test_too_little_to_judge_is_said_plainly(client: TestClient, model: Model) -> None:
    model.answers = [
        reply(enough_evidence=False, criteria=None, summary="Please write more.", corrections=[])
    ]
    got = post(client, answer="Bad.").json()["evaluation"]
    assert got["enough_evidence"] is False
    assert got["overall"] is None and got["criteria"] is None and got["corrections"] == []


def test_the_overall_score_is_the_mean_of_the_marks() -> None:
    marks = {"task": 5, "organization": 4, "vocabulary": 4, "grammar": 3, "mechanics": 4}
    raw = json.loads(reply())
    raw["criteria"] = {k: {"score": v, "comment": "c"} for k, v in marks.items()}
    out = clean(ModelEvaluation.model_validate(raw), ANSWER)
    assert out.overall == 4  # 20 / 5


# -- failures ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    ["", "not json at all", "[]", '{"enough_evidence": true}', reply(criteria={"task": 1})],
)
def test_a_malformed_reply_fails_gracefully_and_keeps_the_answer(
    client: TestClient, model: Model, bad: str
) -> None:
    model.answers = [bad]
    cid = uuid.uuid4()
    r = post(client, client_id=cid)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "writing_bad_output"
    saved = client.get("/api/writing/submissions", headers=as_("ann")).json()
    assert [s["status"] for s in saved] == ["failed"]
    row = client.get(f"/api/writing/submissions/{saved[0]['id']}", headers=as_("ann")).json()
    assert row["answer"] == ANSWER and row["evaluation"] is None


def test_a_model_outage_fails_with_a_clear_code(client: TestClient, model: Model) -> None:
    model.answers = [ApiError(502, "writing_failed", "The feedback service did not answer")]
    r = post(client)
    assert (r.status_code, r.json()["error"]["code"]) == (502, "writing_failed")


def test_a_retry_after_failure_evaluates_the_same_attempt_again(
    client: TestClient, model: Model
) -> None:
    model.answers = [ApiError(502, "writing_failed", "down"), reply()]
    cid = uuid.uuid4()
    assert post(client, client_id=cid).status_code == 502
    ok = post(client, client_id=cid, answer=ANSWER + " I like it.")  # edited meanwhile
    assert ok.status_code == 200 and ok.json()["status"] == "done"
    assert ok.json()["answer"].endswith("I like it.")
    assert len(client.get("/api/writing/submissions", headers=as_("ann")).json()) == 1


# -- duplicates ----------------------------------------------------------------------------------


def test_a_duplicate_submission_is_not_evaluated_twice(client: TestClient, model: Model) -> None:
    cid = uuid.uuid4()
    first = post(client, client_id=cid).json()
    second = post(client, client_id=cid).json()
    assert second["id"] == first["id"]
    assert model.calls == 1
    assert len(client.get("/api/writing/submissions", headers=as_("ann")).json()) == 1


def test_a_second_tap_while_checking_is_refused(client: TestClient, model: Model) -> None:
    cid = uuid.uuid4()

    def tap_again(system: str, user: str, settings: object) -> str:
        again = post(client, client_id=cid)  # arrives while the first is still with the model
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "writing_in_progress"
        return reply()

    evaluator._ask = tap_again
    assert post(client, client_id=cid).status_code == 200


# -- persistence and ownership -------------------------------------------------------------------


def test_submissions_are_listed_newest_first_and_filterable(
    client: TestClient, model: Model
) -> None:
    post(client)
    later = {"X-Dev-User": "ann"} | at(MOMENT.replace(minute=5))
    body = {"client_id": str(uuid.uuid4()), "question_id": "edu-subject", "answer": ANSWER}
    client.post("/api/writing/submissions", json=body, headers=later)
    everything = client.get("/api/writing/submissions", headers=as_("ann")).json()
    assert len(everything) == 2 and everything[0]["question_id"] == "edu-subject"
    only = client.get(
        "/api/writing/submissions?question_id=life-morning", headers=as_("ann")
    ).json()
    assert [s["question_id"] for s in only] == ["life-morning"] and only[0]["overall"] == 3


def test_one_learner_cannot_read_another_learners_submission(
    client: TestClient, model: Model
) -> None:
    mine = post(client, who="ann").json()
    assert (
        client.get(f"/api/writing/submissions/{mine['id']}", headers=as_("bob")).status_code == 404
    )
    assert client.get("/api/writing/submissions", headers=as_("bob")).json() == []
    assert (
        client.get(f"/api/writing/submissions/{mine['id']}", headers=as_("ann")).status_code == 200
    )


def test_the_same_client_id_from_two_learners_is_two_attempts(
    client: TestClient, model: Model
) -> None:
    cid = uuid.uuid4()
    a = post(client, who="ann", client_id=cid).json()
    b = post(client, who="bob", client_id=cid).json()
    assert a["id"] != b["id"] and model.calls == 2


def test_the_daily_limit_stops_a_flood(
    client: TestClient, model: Model, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "writing_submissions_per_day", 2)
    assert [post(client).status_code for _ in range(3)] == [200, 200, 429]
