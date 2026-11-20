"""What the mentor can do in a chat (ADR 0072): tools the model calls, run here on the coach's
rules (ADR 0071). Each returns a card for the screen and a short result for the model. Nothing
is saved by a tool: a goal, a schedule or a study time becomes real only when the learner taps
the card. Activities only ever point at things that exist: today's tasks as the app sent them,
or the Writing and Speaking sections."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import User
from app.services import memory
from app.services import promise as promises
from app.services.coach import service as coach
from app.services.coach.goal import GOAL_KINDS, Goal, feasibility

ACTIVITY_KINDS = ("vocab", "spelling", "reading", "writing", "speaking")
EVENT_KINDS = ("school", "work", "sport", "chore", "personal", "other")
MAX_EVENTS = 12
# Minutes assumed for a section with no task of its own today.
SECTION_MINUTES = {"writing": 15, "speaking": 5}

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "what_now",
            "description": (
                "What the learner should do right now: their next task from today's plan if they "
                "are free, or when their current schedule block ends. Call it whenever they ask "
                "what to do, what next, or seem unsure."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_activity",
            "description": (
                "Offer one activity with a «Start now» button. kind: vocab or spelling (a deck "
                "from today's plan), reading (an article from today's plan), writing or speaking "
                "(their sections). Use it when the learner wants a particular kind of practice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(ACTIVITY_KINDS)},
                    "why": {
                        "type": "string",
                        "description": "One short reason, learner's language",
                    },
                },
                "required": ["kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_week_plan",
            "description": (
                "The learner's goal, whether it is on track, this week's targets with progress, "
                "and their promised study time."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_goal",
            "description": (
                "Show a goal for the learner to confirm, with an honest check of whether their "
                "time reaches it. Does not save it. Ask for what is missing first (what for, "
                "target, by when) unless they already said."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(GOAL_KINDS)},
                    "target": {
                        "type": "string",
                        "description": "A CEFR level like B2, or an IELTS band like 6.5",
                    },
                    "deadline": {"type": "string", "description": "YYYY-MM-DD"},
                    "why": {"type": "string"},
                },
                "required": ["kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_schedule",
            "description": (
                "Turn what the learner said about their week (school, work, sport, chores...) into "
                "calendar events for them to confirm. Does not save them."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "events": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "kind": {"type": "string", "enum": list(EVENT_KINDS)},
                                "weekdays": {
                                    "type": "array",
                                    "items": {"type": "integer", "minimum": 0, "maximum": 6},
                                    "description": "0 = Monday … 6 = Sunday",
                                },
                                "start": {"type": "string", "description": "HH:MM"},
                                "end": {"type": "string", "description": "HH:MM"},
                            },
                            "required": ["title", "kind", "weekdays", "start", "end"],
                        },
                    }
                },
                "required": ["events"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_study_times",
            "description": (
                "Find 2–3 good times to study, free on the chosen days and near when the learner "
                "already studies, for them to pick and promise."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "minutes": {"type": "integer", "minimum": 5, "maximum": 120},
                    "weekdays": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0, "maximum": 6},
                    },
                    "preference": {"type": "string", "enum": ["morning", "day", "evening"]},
                },
                "required": ["minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_exception",
            "description": (
                "When the learner says a day is different: a usual block isn't happening "
                "(skip_day: 'no school tomorrow'), something extra on one date (one_off: "
                "'a concert on Saturday 15-18'), or days off from studying (pause: illness, "
                "a trip, until a date). "
                "Shows a card to confirm. Does not save it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["skip_day", "one_off", "pause"]},
                    "date": {"type": "string", "description": "YYYY-MM-DD; the first day"},
                    "until": {"type": "string", "description": "YYYY-MM-DD; pause only"},
                    "title": {
                        "type": "string",
                        "description": "one_off: what it is; skip_day: which block (empty: all)",
                    },
                    "start": {"type": "string", "description": "HH:MM, one_off only"},
                    "end": {"type": "string", "description": "HH:MM, one_off only"},
                },
                "required": ["kind", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "offer_replies",
            "description": (
                "End an answer with 2–4 short replies the learner might tap instead of typing, in "
                "their language (e.g. 'Starting now', 'Later', 'Not today'). Call it last."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "replies": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 4,
                    }
                },
                "required": ["replies"],
            },
        },
    },
]


TOOLS += [
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "Offer to remember one lasting fact about the learner (why they learn, likes, "
                "dislikes, a limit on their time, when they have energy, their own word for "
                "something). Shows a chip; saved only if they tap it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(memory.FACT_KINDS)},
                    "text": {"type": "string", "description": "One short fact, their language"},
                },
                "required": ["kind", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": (
                "Look up what the learner told you before, what happened with their plan, and "
                "earlier chats, by a few words."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
]


@dataclass(frozen=True)
class ToolContext:
    db: Session
    user: User
    now: datetime
    zone: ZoneInfo
    # Today's tasks as the app made them (the chat request's plan).
    plan: Sequence[Mapping[str, Any]]


@dataclass(frozen=True)
class ToolResult:
    # What the screen shows: a card, or None for a step with nothing to show.
    card: dict[str, Any] | None
    # What the model is told.
    result: dict[str, Any]


def _hhmm(minute: int | None) -> str | None:
    return None if minute is None else f"{minute // 60:02d}:{minute % 60:02d}"


def _minute(text: Any) -> int | None:
    match = re.fullmatch(r"\s*(\d{1,2})[:.](\d{2})\s*", str(text))
    if not match:
        return None
    hours, minutes = int(match[1]), int(match[2])
    if hours == 24 and minutes == 0:
        return 1440
    return hours * 60 + minutes if hours < 24 and minutes < 60 else None


def _activity(task: Mapping[str, Any], why: str | None = None) -> dict[str, Any]:
    """A card the screen turns into «Начать сейчас», from one of today's tasks."""
    return {
        "type": "activity",
        "kind": task.get("kind"),
        "deck_id": task.get("deckId"),
        "article_id": task.get("articleId"),
        "title": task.get("title"),
        "minutes": task.get("minutes"),
        "count": task.get("count"),
        "why": why,
    }


def _section(kind: str, why: str | None) -> dict[str, Any]:
    return {
        "type": "activity",
        "kind": kind,
        "deck_id": None,
        "article_id": None,
        "title": None,
        "minutes": SECTION_MINUTES[kind],
        "count": None,
        "why": why,
    }


def what_now(ctx: ToolContext, _: Mapping[str, Any]) -> ToolResult:
    now = coach.now_for(ctx.db, ctx.user, ctx.plan, ctx.now, ctx.zone)
    local = ctx.now.astimezone(ctx.zone)
    result: dict[str, Any] = {
        "state": now.state,
        "local_time": local.strftime("%H:%M"),
        "until": _hhmm(now.until),
        "busy_with": now.busy_with,
        "study_time": _hhmm(now.study_start),
        "in_study_time": now.in_study_time,
        "task": dict(now.task) if now.task else None,
        "tasks_left": len(ctx.plan),
    }
    card = _activity(now.task) if now.state == "do" and now.task else None
    if now.state == "busy":
        card = {"type": "busy", "busy_with": now.busy_with, "until": now.until}
    if now.state == "done":
        card = {"type": "done"}
    return ToolResult(card, result)


def suggest_activity(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    kind = args.get("kind")
    why = str(args["why"])[:160] if args.get("why") else None
    if kind in ("writing", "speaking"):
        return ToolResult(_section(kind, why), {"offered": kind})
    task = next((t for t in ctx.plan if t.get("kind") == kind), None)
    if task is None:
        # Nothing of that kind today: say so rather than invent one.
        return ToolResult(None, {"offered": None, "reason": f"no {kind} task today"})
    return ToolResult(_activity(task, why), {"offered": dict(task)})


def get_week_plan(ctx: ToolContext, _: Mapping[str, Any]) -> ToolResult:
    state = coach.coach_state(ctx.db, ctx.user, ctx.now, ctx.zone)
    goal = state.goal
    seen = state.feasibility
    result = {
        "goal": {"kind": goal.kind, "target": goal.target, "deadline": str(goal.deadline or "")}
        if goal
        else None,
        "status": seen.status if seen else None,
        "minutes_a_day_needed": seen.minutes_a_day_needed if seen else None,
        "targets": [
            {"skill": t.skill, "planned": t.planned, "done": t.done} for t in state.targets
        ],
        "behind": state.behind,
        "study_time": _hhmm(state.commitment.start_minute),
        "minutes": state.commitment.minutes,
        "promised_days": sum(state.promised),
        "studied_days": sum(state.studied),
    }
    return ToolResult({"type": "week", **result}, result)


def propose_goal(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    kind = args.get("kind")
    if kind not in GOAL_KINDS:
        return ToolResult(None, {"error": "unknown goal kind"})
    try:
        deadline = date.fromisoformat(str(args["deadline"])) if args.get("deadline") else None
    except ValueError:
        deadline = None
    target = str(args["target"])[:8] if args.get("target") else None
    why = str(args["why"])[:300] if args.get("why") else None
    start = coach.course_level(ctx.db, ctx.user)
    state = coach.coach_state(ctx.db, ctx.user, ctx.now, ctx.zone)
    minutes = state.commitment.minutes or ctx.user.mentor_daily_minutes or coach.DEFAULT_MINUTES
    days = max(1, bin(state.commitment.weekdays).count("1"))
    today = ctx.now.astimezone(ctx.zone).date()
    seen = feasibility(Goal(kind, target, deadline, why, start), minutes, days, today)
    card = {
        "type": "goal",
        "kind": kind,
        "target": target,
        "deadline": deadline.isoformat() if deadline else None,
        "why": why,
        "start_level": start,
        "status": seen.status,
        "hours_needed": seen.hours_needed,
        "weekly_minutes": seen.weekly_minutes,
        "minutes_a_day_needed": seen.minutes_a_day_needed,
        "reached_by": seen.reached_by.isoformat() if seen.reached_by else None,
    }
    return ToolResult(card, {**card, "saved": False})


def propose_schedule(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    events: list[dict[str, Any]] = []
    dropped = 0
    for raw in list(args.get("events") or [])[:MAX_EVENTS]:
        if not isinstance(raw, Mapping):
            dropped += 1
            continue
        title = str(raw.get("title") or "").strip()[:80]
        kind = raw.get("kind") if raw.get("kind") in EVENT_KINDS else "other"
        days = sorted({d for d in raw.get("weekdays") or [] if isinstance(d, int) and 0 <= d <= 6})
        start, end = _minute(raw.get("start")), _minute(raw.get("end"))
        if not title or not days or start is None or end is None or not start < end <= 1440:
            dropped += 1
            continue
        events.append(
            {
                "title": title,
                "kind": kind,
                "weekdays": days,
                "start_minute": start,
                "end_minute": end,
            }
        )
    card = {"type": "schedule", "events": events} if events else None
    return ToolResult(card, {"proposed": len(events), "dropped": dropped, "saved": False})


def propose_study_times(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    minutes = max(5, min(120, int(args.get("minutes") or coach.DEFAULT_MINUTES)))
    days = sorted({d for d in args.get("weekdays") or [] if isinstance(d, int) and 0 <= d <= 6})
    mask = sum(1 << d for d in days) or promises.promise_of(ctx.db, ctx.user).mask_on(
        ctx.now.astimezone(ctx.zone).date()
    )
    preference = (
        args.get("preference") if args.get("preference") in ("morning", "day", "evening") else None
    )
    options = coach.study_times(ctx.db, ctx.user, mask, minutes, preference, ctx.now, ctx.zone)
    listed: list[dict[str, Any]] = [
        {
            "weekdays": [d for d in range(7) if o.weekdays >> d & 1],
            "start_minute": o.start,
            "minutes": o.minutes,
            "reasons": list(o.reasons),
        }
        for o in options
    ]
    card = {"type": "study_times", "options": listed} if listed else None
    told = [{**o, "start": _hhmm(o["start_minute"])} for o in listed]
    return ToolResult(card, {"options": told, "saved": False})


# How far ahead a one-day change may be planned, and how long a pause may last (as promises).
EXCEPTION_DAYS_AHEAD = 60
MAX_PAUSE_DAYS = promises.MAX_PAUSE_DAYS


def _day(text: Any, today: date) -> date | None:
    """A date as YYYY-MM-DD, or «today» / «tomorrow» as words."""
    word = str(text).strip().lower()
    if word in ("today", "tomorrow"):
        return today + timedelta(days=word == "tomorrow")
    try:
        return date.fromisoformat(word)
    except ValueError:
        return None


def propose_exception(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    """A one-day change or a pause, checked; the learner's tap applies it."""
    kind = args.get("kind")
    today = ctx.now.astimezone(ctx.zone).date()
    day = _day(args.get("date"), today)
    if kind not in ("skip_day", "one_off", "pause") or day is None:
        return ToolResult(None, {"error": "need kind and a YYYY-MM-DD date"})
    if not today <= day <= today + timedelta(days=EXCEPTION_DAYS_AHEAD):
        return ToolResult(None, {"error": "the date must be from today to 60 days ahead"})
    title = str(args.get("title") or "").strip()[:80]
    card: dict[str, Any] = {"type": "exception", "kind": kind, "date": day.isoformat()}
    if kind == "pause":
        until = _day(args.get("until"), today) or day
        until = min(max(until, day), today + timedelta(days=MAX_PAUSE_DAYS))
        card["until"] = until.isoformat()
    elif kind == "one_off":
        start, end = _minute(args.get("start")), _minute(args.get("end"))
        if not title or start is None or end is None or not start < end <= 1440:
            return ToolResult(None, {"error": "a one-off needs a title and HH:MM start < end"})
        card |= {"title": title, "start_minute": start, "end_minute": end}
    else:
        # «школы» names «Школа»: the word without its last letter, so endings don't matter.
        stem = title.casefold()[:-1] if len(title) > 4 else title.casefold()
        blocks = [
            (event_id, name)
            for event_id, name in coach.repeating_on(ctx.db, ctx.user, day)
            if not stem or stem in name.casefold()
        ]
        if not blocks:
            return ToolResult(None, {"error": "no usual block that day", "saved": False})
        card["events"] = [{"id": str(i), "title": name} for i, name in blocks]
    return ToolResult(card, {**card, "saved": False})


def offer_replies(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    replies = [str(r).strip()[:40] for r in (args.get("replies") or []) if str(r).strip()][:4]
    if not replies:
        return ToolResult(None, {"shown": 0})
    return ToolResult({"type": "replies", "replies": replies}, {"shown": len(replies)})


def remember(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    kind = args.get("kind") if args.get("kind") in memory.FACT_KINDS else "other"
    text = " ".join(str(args.get("text") or "").split())[:200]
    if not text:
        return ToolResult(None, {"error": "no fact"})
    return ToolResult(
        {"type": "memory", "kind": kind, "text": text}, {"offered": text, "saved": False}
    )


def recall(ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    query = str(args.get("query") or "").strip()[:80]
    if not query:
        return ToolResult(None, {"error": "no query"})
    return ToolResult(None, dict(memory.search(ctx.db, ctx.user, query, ctx.zone)))


RUNNERS = {
    "remember": remember,
    "recall": recall,
    "propose_exception": propose_exception,
    "offer_replies": offer_replies,
    "what_now": what_now,
    "suggest_activity": suggest_activity,
    "get_week_plan": get_week_plan,
    "propose_goal": propose_goal,
    "propose_schedule": propose_schedule,
    "propose_study_times": propose_study_times,
}


def run(name: str, ctx: ToolContext, args: Mapping[str, Any]) -> ToolResult:
    runner = RUNNERS.get(name)
    if runner is None:
        return ToolResult(None, {"error": f"unknown tool {name}"})
    return runner(ctx, args)
