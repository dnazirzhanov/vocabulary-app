"""Asks DeepSeek (through the key and endpoint the drafting feature already uses) to evaluate one
answer, and turns whatever comes back into a validated `Evaluation` or a clear failure.

Nothing here touches the database or the learner's session: it takes text and returns feedback."""

from __future__ import annotations

import logging

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import ApiError
from app.services.generation import DEEPSEEK_URL
from app.services.writing import prompt
from app.services.writing.questions import WritingQuestion
from app.services.writing.schema import Evaluation, ModelEvaluation, clean

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 60.0
MAX_TOKENS = 4000  # the longest feedback measured was ~1,200 tokens; the rest is margin


def _ask(system: str, user: str, settings: Settings) -> str:
    """One call to the model; the only function that talks to the network."""
    import openai

    if not settings.deepseek_api_key:
        raise ApiError(503, "writing_unavailable", "The feedback service is not set up")
    client = openai.OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=DEEPSEEK_URL,
        timeout=TIMEOUT_SECONDS,
        max_retries=1,
    )
    try:
        response = client.chat.completions.create(
            model=settings.deepseek_model,
            max_tokens=MAX_TOKENS,
            temperature=0,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            # Measured: reasoning made feedback several times slower with no better corrections.
            extra_body={"thinking": {"type": "disabled"}},
        )
    except openai.AuthenticationError as error:
        raise ApiError(503, "writing_unavailable", "The feedback service key is wrong") from error
    except openai.RateLimitError as error:
        raise ApiError(503, "writing_busy", "The feedback service is busy") from error
    except openai.APIStatusError as error:
        if error.status_code == 402:  # DeepSeek: the account's balance is used up
            raise ApiError(
                503, "writing_unavailable", "The feedback account is out of credit"
            ) from error
        raise ApiError(502, "writing_failed", "The feedback service did not answer") from error
    except openai.APIConnectionError as error:
        raise ApiError(502, "writing_failed", "The feedback service did not answer") from error
    choice = response.choices[0] if response.choices else None
    return (choice.message.content or "") if choice else ""


def evaluate(
    question: WritingQuestion, answer: str, feedback_language: str, settings: Settings
) -> Evaluation:
    system = prompt.system_prompt(feedback_language)
    user = prompt.user_message(question.title, question.instruction, answer)
    evaluation = _evaluate_once(system, user, answer, settings)
    words = prompt.word_count(answer)
    if words >= prompt.ALWAYS_ASSESS_WORDS and evaluation.overall is None:
        # A long enough answer is always marked: ask once more, saying why.
        reminder = prompt.REMINDER.format(words=words)
        evaluation = _evaluate_once(system, f"{user}\n\n{reminder}", answer, settings)
        if evaluation.overall is None:
            logger.warning("writing evaluation refused a long answer twice")
            raise ApiError(502, "writing_bad_output", "The feedback could not be read")
    return evaluation


def _evaluate_once(system: str, user: str, answer: str, settings: Settings) -> Evaluation:
    # JSON mode can now and then answer with nothing (DeepSeek's docs): one more try.
    content = ""
    for _ in range(2):
        content = _ask(system, user, settings)
        if content.strip():
            break
    try:
        return clean(ModelEvaluation.model_validate_json(content), answer)
    except (ValidationError, ValueError) as error:
        # Never log the learner's text or the model's reply, only that the shape was wrong.
        logger.warning(
            "writing evaluation had a bad shape", extra={"fields": {"empty": not content.strip()}}
        )
        raise ApiError(502, "writing_bad_output", "The feedback could not be read") from error
