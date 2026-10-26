"""Developer commands. Usage: uv run python -m app.cli <command> [args]."""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.services.content import (
    ContentError,
    import_deck,
    import_glossary,
    missing_glossary_forms,
    parse_deck,
    parse_glossary,
)
from app.services.demo import seed_classmates


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("validate-content", "check a deck directory without touching the database"),
        ("load-content", "validate a deck directory and import it into DATABASE_URL"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("directory", type=Path)
    seed = commands.add_parser(
        "seed-classmates", help="development only: a demo group with made-up classmates"
    )
    seed.add_argument("--owner", default="local", help="the X-Dev-User who owns the group")
    args = parser.parse_args(argv)

    if args.command == "seed-classmates":
        settings = get_settings()
        if settings.environment != "development" or settings.auth_mode != "dev":
            print("seed-classmates only runs against a development database", file=sys.stderr)
            return 1
        with get_sessionmaker()() as db:
            code = seed_classmates(db, f"dev|{args.owner}", datetime.now(UTC))
        print(f"Demo group ready (invite code {code}); open the app and go to «Друзья».")
        return 0

    try:
        content = parse_deck(args.directory)
        # The glossary sits next to the deck directories and must cover every example word.
        glossary = parse_glossary(args.directory.parent / "glossary.yaml")
        missing = missing_glossary_forms(content, glossary)
        if missing:
            raise ContentError(missing)
    except ContentError as exc:
        print(f"{args.directory}: {len(exc.problems)} problem(s)", file=sys.stderr)
        for problem in exc.problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    if args.command == "validate-content":
        print(
            f"{args.directory}: deck {content.deck.id!r} with {len(content.words)} words is valid"
        )
        return 0

    with get_sessionmaker()() as db:
        stats = import_deck(db, content)
        forms = import_glossary(db, glossary)
    print(
        f"Imported deck {content.deck.id!r}: {stats.words} words, {stats.deck_words} in deck order;"
        f" glossary: {forms} word forms"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
