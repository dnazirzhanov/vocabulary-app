"""Fills a dedicated database with made-up classes and months of history, as the real tables would
hold it. Usage: uv run python -m loadtest.seed --students 1000 --days 180"""

import argparse
import json
import os
import random
import sys
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg

CLASS_SIZE = 30
NEW_PER_DAY = 5
REVIEWS_PER_DAY = 15
SPELLED_PER_DAY = 5
TEACHER_DECKS = 5
WORDS_PER_DECK = 40
ZONE = "Asia/Bishkek"


def load_url() -> str:
    """Only a database named for this test: it is emptied first."""
    url = os.environ["DATABASE_URL"].replace("+psycopg", "")
    if not url.rsplit("?")[0].endswith("_load"):
        sys.exit("DATABASE_URL must name a database ending in _load")
    return url


def seed(url: str, students: int, days: int, seed_value: int = 7) -> None:
    rng = random.Random(seed_value)  # made-up data, the same every run

    def uid() -> UUID:
        return UUID(int=rng.getrandbits(128), version=4)

    now = datetime.now(UTC)
    with psycopg.connect(url, autocommit=True) as db:
        # Users go by DELETE: a TRUNCATE would cascade to every deck, the course too.
        db.execute(
            "TRUNCATE groups, group_members, learning_sessions, review_attempts,"
            " user_word_progress, spelling_progress, deck_assignments, push_subscriptions,"
            " deck_paces, promise_changes, promise_pauses, study_day_totals CASCADE"
        )
        db.execute("DELETE FROM decks WHERE kind = 'user'")
        db.execute("DELETE FROM users")
        course = [
            row[0]
            for row in db.execute(
                "SELECT word_id FROM deck_words WHERE deck_id IN ('a1-a2', 'b1-b2', 'c1')"
                " ORDER BY deck_id, position"
            )
        ]

        ids = [uid() for _ in range(students)]
        # Who studies how often: some nearly every day, some rarely, about half the days on average.
        keenness = [rng.uniform(0.2, 0.8) for _ in ids]
        groups = [ids[start : start + CLASS_SIZE] for start in range(0, students, CLASS_SIZE)]
        group_ids = [uid() for _ in groups]
        pools: dict[UUID, list[str]] = {}
        joined = now - timedelta(days=days + 1)

        with db.cursor() as cursor:
            with cursor.copy(
                "COPY users (id, auth_subject, time_zone, daily_target_words,"
                " study_days_per_week, onboarded_at) FROM STDIN"
            ) as copy:
                for number, user in enumerate(ids):
                    copy.write_row((user, f"dev|load-{number:04d}", ZONE, NEW_PER_DAY, 6, joined))
            with cursor.copy("COPY groups (id, name, invite_code, time_zone) FROM STDIN") as copy:
                for number, group in enumerate(group_ids):
                    copy.write_row((group, f"Класс {number}", f"L{number:07d}", ZONE))
            with cursor.copy(
                "COPY group_members (id, group_id, user_id, nickname, role, joined_at) FROM STDIN"
            ) as copy:
                for group, members in zip(group_ids, groups, strict=True):
                    for position, user in enumerate(members):
                        role = "owner" if position == 0 else "member"
                        copy.write_row((uid(), group, user, f"Ученик {position}", role, joined))
            # Each class's teacher writes decks of its own words and gives them to the class.
            for group, members in zip(group_ids, groups, strict=True):
                own: list[str] = []
                for deck_number in range(TEACHER_DECKS):
                    deck_id = f"load-{group.hex[:12]}-{deck_number}"
                    cursor.execute(
                        "INSERT INTO decks (id, title, description, learning_language,"
                        " explanation_language, status, content_version, kind, owner_id)"
                        " VALUES (%s, %s, '', 'en', 'ru', 'published', 1, 'user', %s)",
                        (deck_id, f"Unit {deck_number}", members[0]),
                    )
                    words = [f"{deck_id}-{n}" for n in range(WORDS_PER_DECK)]
                    with cursor.copy(
                        "COPY words (id, headword, pos, translation, also_accept, example,"
                        " example_ru, owner_deck_id) FROM STDIN"
                    ) as copy:
                        for n, word in enumerate(words):
                            copy.write_row(
                                (
                                    word,
                                    f"word{n}",
                                    "noun",
                                    "слово",
                                    [],
                                    "An example.",
                                    "Пример.",
                                    deck_id,
                                )
                            )
                    with cursor.copy(
                        "COPY deck_words (deck_id, word_id, position) FROM STDIN"
                    ) as copy:
                        for n, word in enumerate(words):
                            copy.write_row((deck_id, word, n + 1))
                    cursor.execute(
                        "INSERT INTO deck_assignments (id, group_id, deck_id, assigned_by,"
                        " assigned_at) VALUES (%s, %s, %s, %s, %s)",
                        (uid(), group, deck_id, members[0], joined),
                    )
                    own += words
                for user in members:
                    pools[user] = course + own

            # Made first and written table by table: one connection runs one COPY at a time.
            sessions: list[tuple[Any, ...]] = []
            attempts: list[tuple[Any, ...]] = []
            progress: list[tuple[Any, ...]] = []
            spelling: list[tuple[Any, ...]] = []
            for user, keen in zip(ids, keenness, strict=True):
                pool = pools[user]
                met = 0
                for ago in range(days, 0, -1):
                    if rng.random() > keen:
                        continue
                    moment = now - timedelta(days=ago, minutes=rng.randrange(600))
                    new = pool[met : met + NEW_PER_DAY]
                    known = pool[max(0, met - 200) : met]
                    reviews = rng.sample(known, min(REVIEWS_PER_DAY, len(known)))
                    session = uid()
                    plan = [
                        {"id": f"e{n}", "type": "card", "word_id": word, "new": word in new}
                        for n, word in enumerate(new + reviews)
                    ]
                    sessions.append(
                        (
                            session,
                            user,
                            "a1-a2",
                            "study",
                            json.dumps(plan),
                            moment,
                            moment,
                            NEW_PER_DAY,
                            6,
                            None,
                        )
                    )
                    for step, word in enumerate(new + reviews):
                        is_new = word in new
                        at = moment + timedelta(seconds=4 * step)
                        rating = 3 if is_new or rng.random() < 0.85 else 1
                        attempts.append(
                            (
                                session,
                                user,
                                word,
                                f"e{step}",
                                "card",
                                None,
                                at,
                                rating,
                                not is_new,
                                2 if is_new else 0,
                            )
                        )
                    for word in new:
                        due = now + timedelta(days=rng.randint(-5, 20))
                        progress.append(
                            (
                                user,
                                word,
                                moment,
                                moment,
                                1,
                                2,
                                rng.uniform(1, 30),
                                rng.uniform(1, 10),
                                due,
                                moment,
                                1,
                            )
                        )
                    if rng.random() < 0.5:
                        spell = uid()
                        spelled = rng.sample(
                            pool[: met + len(new)],
                            min(SPELLED_PER_DAY, len(pool[: met + len(new)])),
                        )
                        steps = [
                            {
                                "id": f"s{n}",
                                "type": "spelling",
                                "word_id": word,
                                "new": False,
                                "tiles": list("abcdefgh"),
                            }
                            for n, word in enumerate(spelled)
                        ]
                        sessions.append(
                            (
                                spell,
                                user,
                                None,
                                "spelling",
                                json.dumps(steps),
                                moment,
                                moment,
                                None,
                                None,
                                len(spelled),
                            )
                        )
                        for step, word in enumerate(spelled):
                            attempts.append(
                                (
                                    spell,
                                    user,
                                    word,
                                    f"s{step}",
                                    "spelling",
                                    True,
                                    moment,
                                    None,
                                    False,
                                    0,
                                )
                            )
                    met += len(new)
                for word in pool[: min(met, 150)]:
                    spelling.append(
                        (
                            user,
                            word,
                            rng.randint(0, 3),
                            now + timedelta(days=rng.randint(0, 30)),
                            now,
                        )
                    )
            for statement, rows in (
                (
                    "COPY learning_sessions (id, user_id, deck_id, kind, plan, started_at,"
                    " completed_at, day_target, promised_days, spelling_words) FROM STDIN",
                    sessions,
                ),
                (
                    "COPY review_attempts (session_id, user_id, word_id, exercise_id,"
                    " exercise_type, correct, answered_at, rating, was_review, points)"
                    " FROM STDIN",
                    attempts,
                ),
                (
                    "COPY user_word_progress (user_id, word_id, introduced_at, last_seen_at,"
                    " correct_count, fsrs_state, stability, difficulty, due_at,"
                    " last_reviewed_at, review_count) FROM STDIN",
                    progress,
                ),
                (
                    "COPY spelling_progress (user_id, word_id, rung, due_at, last_spelled_at)"
                    " FROM STDIN",
                    spelling,
                ),
            ):
                with cursor.copy(statement) as copy:
                    for row in rows:
                        copy.write_row(row)
        db.execute(
            "UPDATE user_word_progress AS p SET first_recalled_at = f.at FROM ("
            " SELECT user_id, word_id, min(answered_at) AS at FROM review_attempts"
            " WHERE was_review AND rating >= 2 GROUP BY user_id, word_id) AS f"
            " WHERE p.user_id = f.user_id AND p.word_id = f.word_id"
        )
        db.execute("VACUUM ANALYZE")
        report(db, students)


def report(db: psycopg.Connection, students: int) -> None:
    rows = db.execute(
        "SELECT c.relname, c.reltuples::bigint, pg_total_relation_size(c.oid)"
        " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = 'public' AND c.relkind = 'r'"
        " ORDER BY 3 DESC LIMIT 7"
    ).fetchall()
    for name, count, size in rows:
        print(f"{name:24} {count:>10,} rows {size / 1e6:9.1f} MB")
    total = db.execute("SELECT pg_database_size(current_database())").fetchone()
    assert total is not None
    print(f"{'database':24} {students:>10,} students {total[0] / 1e6:5.1f} MB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--students", type=int, default=1000)
    parser.add_argument("--days", type=int, default=180)
    args = parser.parse_args()
    seed(load_url(), args.students, args.days)


if __name__ == "__main__":
    main()
