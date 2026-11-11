"""Developer commands. Usage: uv run python -m app.cli <command> [args]."""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models import WordingReport
from app.services import reading
from app.services.cleanup import clean_up
from app.services.content import (
    ContentError,
    DeckContent,
    duplicate_words,
    import_deck,
    import_glossary,
    missing_glossary_forms,
    parse_deck,
    parse_glossary,
)
from app.services.demo import seed_classmates
from app.services.reminders import WebPushSender, send_reminders, vapid_keys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("validate-content", "check deck directories without touching the database"),
        ("load-content", "validate deck directories and import them into DATABASE_URL"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("directories", type=Path, nargs="+")
    seed = commands.add_parser(
        "seed-classmates", help="development only: a demo group with made-up classmates"
    )
    seed.add_argument("--owner", default="local", help="the X-Dev-User who owns the group")
    commands.add_parser(
        "vapid-keys",
        help="a new key pair for reminders: lines for .env (keep the private one secret)",
    )
    commands.add_parser("send-reminders", help="send this hour's notifications (ADR 0042)")
    commands.add_parser("clean-up", help="remove old answers, keeping what screens need (ADR 0044)")
    commands.add_parser("wording-reports", help="the latest reports of bad wording (ADR 0055)")
    commands.add_parser(
        "build-reading",
        help="build content/reading/*.yaml into web/public/reading/*.json (Reading Mode)",
    )
    args = parser.parse_args(argv)

    if args.command == "vapid-keys":
        print("\n".join(f"{name}={value}" for name, value in vapid_keys().items()))
        return 0

    if args.command == "build-reading":
        root = Path(__file__).resolve().parents[2]
        try:
            files = reading.build(
                root / "content" / "reading",
                parse_glossary(root / "content" / "glossary.yaml"),
                reading.course_parts_of_speech(root / "content"),
            )
        except ContentError as error:
            print("\n".join(error.problems), file=sys.stderr)
            return 1
        for name in reading.write(files, root / "web" / "public" / "reading"):
            print(f"wrote web/public/reading/{name}")
        return 0

    if args.command == "wording-reports":
        with get_sessionmaker()() as db:
            for report in db.scalars(
                select(WordingReport).order_by(WordingReport.created_at.desc()).limit(200)
            ):
                print(f"{report.created_at:%Y-%m-%d}\t{report.ui_language}\t{report.text}")
        return 0

    if args.command == "send-reminders":
        settings = get_settings()
        if not settings.vapid_private_key:
            print("send-reminders needs VAPID_PRIVATE_KEY (see vapid-keys)", file=sys.stderr)
            return 1
        with get_sessionmaker()() as db:
            result = send_reminders(db, datetime.now(UTC), WebPushSender(settings), float("inf"))
        print(f"Reminders sent: {result.sent}")
        return 0

    if args.command == "clean-up":
        with get_sessionmaker()() as db:
            print(clean_up(db, datetime.now(UTC), max_seconds=float("inf")))
        return 0

    if args.command == "seed-classmates":
        settings = get_settings()
        if settings.environment != "development" or settings.auth_mode != "dev":
            print("seed-classmates only runs against a development database", file=sys.stderr)
            return 1
        with get_sessionmaker()() as db:
            code = seed_classmates(db, f"dev|{args.owner}", datetime.now(UTC))
        print(f"Demo group ready (invite code {code}); open the app and go to Friends.")
        return 0

    problems: list[str] = []
    decks: list[DeckContent] = []
    for directory in args.directories:
        try:
            decks.append(parse_deck(directory))
        except ContentError as exc:
            problems += [f"{directory}: {problem}" for problem in exc.problems]
    # The glossary sits next to the deck directories and must cover every example word.
    glossary_path = args.directories[0].parent / "glossary.yaml"
    try:
        glossary = parse_glossary(glossary_path)
    except ContentError as exc:
        problems += exc.problems
        glossary = {}
    problems += duplicate_words(decks)
    for content in decks:
        problems += missing_glossary_forms(content, glossary)
    if problems:
        print(f"{len(problems)} problem(s)", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    if args.command == "validate-content":
        for content in decks:
            print(f"deck {content.deck.id!r} ({content.deck.level}): {len(content.words)} words")
        print(f"glossary: {len(glossary)} word forms; all valid")
        return 0

    with get_sessionmaker()() as db:
        for content in decks:
            stats = import_deck(db, content)
            print(f"Imported deck {content.deck.id!r}: {stats.words} words")
        print(f"Imported glossary: {import_glossary(db, glossary)} word forms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
