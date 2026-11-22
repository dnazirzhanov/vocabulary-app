"""Writing: topics and questions, submitting for feedback, malformed or failed evaluations,
duplicates, persistence, and ownership. The model is never called: `evaluator._ask` is replaced."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models import WritingSubmission
from app.services.writing import evaluator
from app.services.writing import questions as bank
from app.services.writing.schema import IeltsModelEvaluation, clean_ielts, overall_band
from tests.support import at

MOMENT = datetime(2026, 11, 18, 10, 0, tzinfo=UTC)
ANSWER = "I no have car. I go to university by bus."


def as_(name: str) -> dict[str, str]:
    return {"X-Dev-User": name} | at(MOMENT)


IELTS = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")


def criteria(band: int = 6) -> dict[str, Any]:
    return {name: {"band": band, "why": "ok", "next_band": "do this"} for name in IELTS}


def reply(**changes: Any) -> str:
    data: dict[str, Any] = {
        "enough_evidence": True,
        "criteria": criteria(),
        "summary": "A clear short answer.",
        "corrections": [
            {
                "original": "I no have car",
                "corrected": "I don't have a car",
                "explanation": "Use don't.",
                "type": "grammar",
            }
        ],
        "upgrades": [{"original": "go to university", "suggestion": "travel to university"}],
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
    assert got["evaluation"]["rubric"] == "ielts" and got["evaluation"]["band"] == 6.0
    assert got["question"]["title"] == "Describe a typical day in your life."
    assert got["evaluation"]["corrections"][0]["corrected"] == "I don't have a car"
    assert got["evaluation"]["upgrades"][0]["suggestion"] == "travel to university"
    assert got["evaluation"]["words"] == len(ANSWER.split())
    # The question and the answer reached the model, fenced as text to assess.
    assert "Describe a typical day" in model.last_user and "<<<ESSAY" in model.last_user


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


def test_an_upgrade_of_words_not_in_the_answer_is_dropped(client: TestClient, model: Model) -> None:
    invented = {"original": "words not in the answer", "suggestion": "better words"}
    model.answers = [reply(upgrades=[invented])]
    assert post(client).json()["evaluation"]["upgrades"] == []


def test_too_many_items_are_cut_not_rejected(client: TestClient, model: Model) -> None:
    same = {"original": "go to university", "suggestion": "travel to university"}
    model.answers = [reply(upgrades=[same] * 9)]
    assert len(post(client).json()["evaluation"]["upgrades"]) == 4


def test_too_little_to_judge_is_said_plainly(client: TestClient, model: Model) -> None:
    model.answers = [
        reply(enough_evidence=False, criteria=None, summary="Please write more.", corrections=[])
    ]
    got = post(client, answer="Bad.").json()["evaluation"]
    assert got["enough_evidence"] is False
    assert got["band"] is None and got["criteria"] is None and got["corrections"] == []
    assert model.calls == 1  # a short answer may be refused: no second request


# 47 words, on another topic than the question: the shape of a pasted article.
OFF_TOPIC = " ".join(["Global temperatures keep rising because greenhouse gases trap heat."] * 4)
OFF_TOPIC += " The end of this pasted text comes here at last now."


def test_a_long_answer_is_always_marked_even_off_topic(client: TestClient, model: Model) -> None:
    refused = reply(enough_evidence=False, criteria=None, summary="Off topic.", corrections=[])
    marks = criteria(6) | {"task_response": {"band": 3, "why": "Off the question."}}
    model.answers = [refused, reply(criteria=marks, corrections=[], upgrades=[])]
    assert len(OFF_TOPIC.split()) >= 40
    got = post(client, answer=OFF_TOPIC).json()["evaluation"]
    assert got["enough_evidence"] is True
    assert got["criteria"]["task_response"]["band"] == 3 and got["band"] == 5.5
    assert model.calls == 2
    assert "must be assessed" in model.last_user  # the second request says why


def test_a_long_answer_refused_twice_fails_and_can_be_retried(
    client: TestClient, model: Model
) -> None:
    refused = reply(enough_evidence=False, criteria=None, summary="Off topic.", corrections=[])
    model.answers = [refused]
    response = post(client, answer=OFF_TOPIC)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "writing_bad_output"


def test_the_prompt_tells_the_model_the_word_count_and_the_rule() -> None:
    from app.services.writing import prompt

    system = prompt.system_prompt("ru")
    assert "An answer under 40 words" in system and "Any longer answer is assessed" in system
    # IELTS, with flexible length (the owner's choice): never marked down for under 250 words.
    assert "Do not lower any band because the answer is under 250 words" in system
    assert "Task Response (TR):" in system and "in Russian" in system
    assert "(47 words;" in prompt.user_message("Q", "I", OFF_TOPIC)


@pytest.mark.parametrize(
    ("bands", "overall"),
    [
        ((6, 6, 6, 6), 6.0),
        ((6, 6, 6, 7), 6.5),  # 6.25 rounds up to 6.5
        ((6, 7, 6, 7), 6.5),  # 6.5 stays
        ((7, 7, 7, 6), 7.0),  # 6.75 rounds up to 7
        ((5, 6, 5, 5), 5.5),  # 5.25 → 5.5
        ((4, 4, 4, 5), 4.5),
    ],
)
def test_the_overall_band_is_rounded_as_ielts_does(
    bands: tuple[int, int, int, int], overall: float
) -> None:
    raw = json.loads(reply())
    raw["criteria"] = {k: {"band": b, "why": "w"} for k, b in zip(IELTS, bands, strict=True)}
    assert clean_ielts(IeltsModelEvaluation.model_validate(raw), ANSWER).band == overall
    assert overall_band(IeltsModelEvaluation.model_validate(raw).criteria) == overall  # type: ignore[arg-type]


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
    assert [s["question_id"] for s in only] == ["life-morning"] and only[0]["band"] == 6.0


def test_the_archive_keeps_every_essay_with_a_glimpse_of_it(
    client: TestClient, model: Model, db: Session
) -> None:
    first = post(client).json()
    owner = db.get(WritingSubmission, uuid.UUID(first["id"]))
    assert owner is not None
    # More essays than the old list showed (20): an archive leaves none out.
    for n in range(1, 25):
        db.add(
            WritingSubmission(
                user_id=owner.user_id,
                client_id=uuid.uuid4(),
                question_id="edu-subject",
                answer=f"Essay number {n}. " + "word " * 60,
                feedback_language="ru",
                status="failed",
                failure_code="writing_unavailable",
                created_at=MOMENT.replace(day=1) + timedelta(hours=n),
            )
        )
    db.commit()

    everything = client.get("/api/writing/submissions", headers=as_("ann")).json()
    assert len(everything) == 25
    newest = everything[0]
    assert newest["id"] == first["id"]
    assert newest["word_count"] == len(ANSWER.split())
    assert newest["excerpt"] == ANSWER
    assert newest["band"] == 6.0
    assert newest["question_topic"] == "Everyday Life"
    oldest = everything[-1]
    # A retired question still has its topic, so its essays group with the rest.
    assert oldest["question_topic"] == "Education"
    assert oldest["excerpt"].startswith("Essay number 1. word") and len(oldest["excerpt"]) <= 141
    assert oldest["excerpt"].endswith("…") and oldest["band"] is None


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


# -- IELTS Task 2 (ADR 0081) ---------------------------------------------------------------------


def test_the_bank_is_ielts_task_2_five_per_topic() -> None:
    assert len(bank.QUESTIONS) == 40
    assert all(n == 5 for _, n in bank.topics())
    assert {q.task_type for q in bank.QUESTIONS} == set(bank.TASK_TYPES)
    assert all(q.instruction.endswith("Write at least 250 words.") for q in bank.QUESTIONS)
    assert all(q.suggested_minutes == 40 for q in bank.QUESTIONS)


def test_retired_questions_still_name_old_answers_but_are_not_offered(client: TestClient) -> None:
    assert bank.get("life-morning") is not None
    offered = client.get("/api/writing/questions?topic=Everyday%20Life", headers=as_("ann")).json()
    assert all(q["id"].startswith("ielts-") for q in offered)
    assert offered[0]["task_type"] == "opinion"


def test_feedback_marked_on_the_old_scale_still_opens(client: TestClient, db: Session) -> None:
    first = client.get("/api/me", headers=as_("ann"))
    assert first.status_code == 200
    from sqlalchemy import select

    from app.models import User

    ann = db.scalars(select(User).where(User.auth_subject == "dev|ann")).one()
    old = {
        "enough_evidence": True,
        "cefr_level": "B1",
        "criteria": {
            n: {"score": 3, "comment": "c"}
            for n in ("task", "organization", "vocabulary", "grammar", "mechanics")
        },
        "summary": "Old feedback.",
        "strengths": [],
        "improvements": ["Old advice"],
        "corrections": [],
        "vocabulary": [],
        "overall": 3,
    }
    row = WritingSubmission(
        user_id=ann.id,
        client_id=uuid.uuid4(),
        question_id="life-morning",
        answer=ANSWER,
        status="done",
        evaluation=old,
        created_at=MOMENT,
    )
    db.add(row)
    db.commit()
    got = client.get(f"/api/writing/submissions/{row.id}", headers=as_("ann")).json()
    assert got["evaluation"]["rubric"] == "general" and got["evaluation"]["overall"] == 3
    listed = client.get("/api/writing/submissions", headers=as_("ann")).json()
    assert listed[0]["overall"] == 3 and listed[0]["band"] is None
