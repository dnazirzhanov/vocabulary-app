"""Play the scenarios against the real model and score them (ADR 0075):

    uv run python -m evals.run --live            # all scenarios
    uv run python -m evals.run --live time-now   # some, by id

Needs DEEPSEEK_API_KEY and DATABASE_URL. Each scenario's learner, facts and schedule are made
inside one transaction that is rolled back at the end: nothing is kept, even where the code
commits (commits become savepoints).
"""

import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_engine
from app.models import LearnerFact, ScheduleEvent, User
from app.services import mentor, mentor_tools
from evals.score import Outcome, score

SCENARIOS = Path(__file__).with_name("scenarios.yaml")
ZONE = ZoneInfo("Asia/Bishkek")


def load() -> list[dict[str, Any]]:
    loaded: list[dict[str, Any]] = yaml.safe_load(SCENARIOS.read_text(encoding="utf-8"))
    return loaded


def _minute(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def play(db: Session, case: dict[str, Any]) -> Outcome:
    now = datetime.strptime(case["local"], "%Y-%m-%d %H:%M").replace(tzinfo=ZONE)
    user = User(
        auth_subject=f"eval|{uuid.uuid4()}",
        name="Тест",
        ui_language=case.get("ui_language", "ru"),
        time_zone=ZONE.key,
    )
    db.add(user)
    db.flush()
    for fact in case.get("facts", []):
        db.add(
            LearnerFact(
                user_id=user.id, kind=fact["kind"], text=fact["text"], source="user", created_at=now
            )
        )
    for block in case.get("schedule", []):
        db.add(
            ScheduleEvent(
                user_id=user.id,
                title=block["title"],
                kind=block["kind"],
                weekdays=block["weekdays"],
                start_minute=_minute(block["start"]),
                end_minute=_minute(block["end"]),
                created_at=now,
                updated_at=now,
            )
        )
    db.flush()
    settings = get_settings()
    plan = case.get("plan", [])
    system, messages, _, _ = mentor._build_context(
        db, user, case["message"], settings, now, ZONE, plan=plan
    )
    ctx = mentor_tools.ToolContext(db, user, now, ZONE, plan)
    parts: list[dict[str, Any]] = []
    outcome = Outcome()
    for event in mentor._stream_with_tools(system, messages, settings, ctx, parts):
        if "delta" in event:
            outcome.text += event["delta"]
    outcome.tools = [p["name"] for p in parts]
    outcome.cards = [p["card"] for p in parts]
    return outcome


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "--live":
        print(__doc__)
        return 2
    wanted = set(argv[1:])
    cases = [c for c in load() if not wanted or c["id"] in wanted]
    failed = 0
    with get_engine().connect() as connection:
        outer = connection.begin()
        db = Session(bind=connection, join_transaction_mode="create_savepoint")
        try:
            for case in cases:
                outcome = play(db, case)
                misses = score(case["expect"], outcome)
                failed += bool(misses)
                mark = "PASS" if not misses else "FAIL"
                print(f"{mark}  {case['id']:<22} tools={outcome.tools}")
                for miss in misses:
                    print(f"      - {miss}")
                print(f"      «{outcome.text.strip()[:160]}»")
        finally:
            db.close()
            outer.rollback()
    print(f"\n{len(cases) - failed}/{len(cases)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
