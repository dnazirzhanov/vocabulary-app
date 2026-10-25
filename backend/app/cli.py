"""Developer commands. Usage: uv run python -m app.cli <command> [args]."""

import argparse
import sys
from pathlib import Path

from app.core.db import get_sessionmaker
from app.services.content import ContentError, import_deck, parse_deck


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("validate-content", "check a deck directory without touching the database"),
        ("load-content", "validate a deck directory and import it into DATABASE_URL"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("directory", type=Path)
    args = parser.parse_args(argv)

    try:
        content = parse_deck(args.directory)
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
    print(
        f"Imported deck {content.deck.id!r}: {stats.words} words, {stats.deck_words} in deck order"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
