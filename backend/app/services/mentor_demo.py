"""Development only (ADR 0072): without a model, the mentor still calls the tool a question
plainly asks for, matched by its words, so the chat's tools can be tried and tested end to end."""

from typing import Any


def tools_for(message: str) -> list[tuple[str, dict[str, Any]]]:
    """The tool a question plainly asks for, by its words, with fixed arguments."""
    said = message.lower()
    if any(w in said for w in ("я люблю", "мне нравится", "i love", "i like")):
        return [("remember", {"kind": "likes", "text": message.strip()[:200]})]
    if any(w in said for w in ("помнишь", "remember what", "я говорил", "я говорила")):
        return [("recall", {"query": message})]
    if any(w in said for w in ("завтра нет", "не будет", "болею", "поездк")):
        return [
            (
                "propose_exception",
                {
                    "kind": "skip_day",
                    "date": "tomorrow",
                    "title": "школы" if "школ" in said else "",
                },
            ),
            ("offer_replies", {"replies": ["Да, отменить", "Нет, всё как обычно"]}),
        ]
    if any(w in said for w in ("расписан", "schedule", "моя неделя", "my week", "учусь")):
        return [
            (
                "propose_schedule",
                {
                    "events": [
                        {
                            "title": "Школа",
                            "kind": "school",
                            "weekdays": [0, 1, 2, 3, 4],
                            "start": "08:00",
                            "end": "14:00",
                        }
                    ]
                },
            )
        ]
    if any(w in said for w in ("когда заниматься", "when to study", "время для", "study time")):
        return [("propose_study_times", {"minutes": 20, "weekdays": [0, 1, 2, 3, 4]})]
    if any(w in said for w in ("цель", "goal", "ielts")):
        return [("propose_goal", {"kind": "ielts", "target": "6.5"})]
    if any(w in said for w in ("неделю", "this week", "прогресс", "progress")):
        return [("get_week_plan", {})]
    if any(w in said for w in ("писать", "эссе", "writing")):
        return [("suggest_activity", {"kind": "writing"})]
    if any(w in said for w in ("говорить", "речь", "speaking")):
        return [("suggest_activity", {"kind": "speaking"})]
    if any(w in said for w in ("сейчас", "делать", "what should", "now", "next")):
        return [
            ("what_now", {}),
            ("offer_replies", {"replies": ["Начинаю", "Позже", "Сегодня не могу"]}),
        ]
    return []
