"""Simulated students against a real server, limited like the free host. A throttled uvicorn (the
CPU share enforced by pausing the process), a proxy before Postgres (network delay, bytes counted).
Usage: uv run python -m loadtest.run --students 30 --seconds 120 --cpu 0.1"""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing
import os
import random
import signal
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from collections.abc import Coroutine
from multiprocessing.sharedctypes import Synchronized
from typing import Any

import httpx2

from loadtest.seed import load_url

PORT = 8123
PROXY_PORT = 55433
# The web app gives up on a request after this long (web/src/lib/api.ts).
CLIENT_TIMEOUT = 15.0
PERIOD = 0.1
BUSY_RETRIES = 3


def throttle(pid: int, share: float) -> None:
    """Runs the process for `share` of each period, like a host's CPU limit."""
    while True:
        try:
            os.kill(pid, signal.SIGCONT)
            time.sleep(PERIOD * share)
            os.kill(pid, signal.SIGSTOP)
            time.sleep(PERIOD * (1 - share))
        except ProcessLookupError:
            return


def proxy(
    target_port: int, delay: float, from_db: Synchronized[int], to_db: Synchronized[int]
) -> None:
    async def pipe(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter, counter: Synchronized[int]
    ) -> None:
        try:
            while data := await reader.read(65536):
                with counter.get_lock():
                    counter.value += len(data)
                if delay:
                    await asyncio.sleep(delay)
                writer.write(data)
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        upstream_reader, upstream_writer = await asyncio.open_connection("localhost", target_port)
        await asyncio.gather(
            pipe(reader, upstream_writer, to_db), pipe(upstream_reader, writer, from_db)
        )

    async def serve() -> None:
        server = await asyncio.start_server(handle, "localhost", PROXY_PORT)
        async with server:
            await server.serve_forever()

    asyncio.run(serve())


class Stats:
    def __init__(self) -> None:
        self.times: dict[str, list[float]] = defaultdict(list)
        self.failures: dict[str, int] = defaultdict(int)
        self.bytes = 0
        self.lessons = 0
        self.refused = 0

    def report(self) -> dict[str, Any]:
        rows = {}
        for name, values in sorted(self.times.items()):
            ordered = sorted(values)
            rows[name] = {
                "n": len(values),
                "p50": round(statistics.median(ordered) * 1000),
                "p95": round(ordered[int(len(ordered) * 0.95) - 1] * 1000),
                "max": round(ordered[-1] * 1000),
                "fail": self.failures[name],
            }
        return rows


async def call(
    client: httpx2.AsyncClient,
    stats: Stats,
    name: str,
    method: str,
    path: str,
    headers: dict[str, str],
    body: Any = None,
) -> httpx2.Response | None:
    started = time.perf_counter()
    # As the web app does (web/src/lib/api.ts): a refused request is tried again after a moment.
    for attempt in range(BUSY_RETRIES + 1):
        try:
            response = await client.request(method, path, headers=headers, json=body)
        except httpx2.HTTPError:
            stats.times[name].append(CLIENT_TIMEOUT)
            stats.failures[name] += 1
            return None
        if response.status_code != 503 or attempt == BUSY_RETRIES:
            break
        stats.refused += 1
        await asyncio.sleep(random.uniform(1, 3))
    stats.times[name].append(time.perf_counter() - started)
    stats.bytes += len(response.content)
    if response.status_code >= 500:
        stats.failures[name] += 1
        return None
    return response


async def journey(
    client: httpx2.AsyncClient, stats: Stats, number: int, rng: random.Random, stop: float
) -> None:
    """What the web app asks for: opening it, a deck's page, a lesson, then a look at friends."""
    headers = {"X-Dev-User": f"load-{number:04d}", "X-Time-Zone": "Asia/Bishkek"}

    def get(name: str, path: str) -> Coroutine[Any, Any, httpx2.Response | None]:
        return call(client, stats, name, "GET", path, headers)

    await asyncio.gather(get("me", "/api/me"), get("decks", "/api/decks"))
    await asyncio.gather(get("library", "/api/decks/library"), get("progress", "/api/progress"))
    await asyncio.sleep(rng.uniform(1, 3))
    deck = "a1-a2"
    await asyncio.gather(
        get("deck_stats", f"/api/decks/{deck}/stats"), get("active", "/api/sessions/active")
    )
    await get("pace", f"/api/me/pace?deck_id={deck}")
    await asyncio.sleep(rng.uniform(1, 3))
    started = await call(
        client, stats, "start", "POST", "/api/sessions", headers, {"kind": "study", "deck_id": deck}
    )
    if started is not None and started.status_code == 200:
        session = started.json()
        exercises = list(session["exercises"])
        index = 0
        while index < len(exercises) and time.monotonic() < stop:
            exercise = exercises[index]
            await asyncio.sleep(rng.uniform(2, 5))
            if exercise["type"] == "card":
                rating = 1 if rng.random() < 0.1 else 3
                answer = {"kind": "rating", "rating": rating}
                result = await call(
                    client,
                    stats,
                    "answer",
                    "POST",
                    f"/api/sessions/{session['id']}/attempts",
                    headers,
                    {"exercise_id": exercise["id"], "response": answer},
                )
                if result is not None and result.status_code == 200:
                    for added in result.json().get("inserted", []):
                        exercises.insert(added["index"], added["exercise"])
            index += 1
        if index == len(exercises):
            await call(
                client,
                stats,
                "complete",
                "POST",
                f"/api/sessions/{session['id']}/complete",
                headers,
            )
            stats.lessons += 1
    await asyncio.gather(get("library", "/api/decks/library"), get("progress", "/api/progress"))
    if rng.random() < 0.4:
        groups = await get("groups", "/api/groups")
        if groups is not None and groups.status_code == 200 and groups.json():
            group = groups.json()[0]["id"]
            await get("board", f"/api/groups/{group}/board?period=week")
    if rng.random() < 0.25:
        await asyncio.gather(
            get("progress", "/api/progress"), get("knowledge", "/api/progress/decks")
        )


def process_usage(pid: int) -> tuple[float, float]:
    """(CPU seconds, resident MB)."""
    output = subprocess.run(
        ["ps", "-o", "cputime=,rss=", "-p", str(pid)],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.split()
    if len(output) < 2:
        return 0.0, 0.0
    minutes, seconds = output[0].split(":")
    return int(minutes) * 60 + float(seconds), int(output[1]) / 1024


def database_cpu(name: str) -> float:
    output = subprocess.run(
        ["ps", "-axo", "cputime=,command="],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    total = 0.0
    for line in output.splitlines():
        if "postgres:" in line and name in line:
            minutes, seconds = line.split()[0].split(":")
            total += int(minutes) * 60 + float(seconds)
    return total


async def drive(students: int, seconds: float, population: int, stats: Stats) -> None:
    stop = time.monotonic() + seconds
    rng = random.Random(11)  # the same students each run
    limits = httpx2.Limits(max_connections=None)
    async with httpx2.AsyncClient(
        base_url=f"http://localhost:{PORT}", timeout=CLIENT_TIMEOUT, limits=limits
    ) as client:

        async def one_student(slot: int) -> None:
            await asyncio.sleep(rng.uniform(0, min(20.0, seconds / 4)))
            while time.monotonic() < stop:
                # A slot only draws from its own share, so no student is in two places at once.
                number = slot + population // students * rng.randrange(students) % population
                await journey(client, stats, number % population, rng, stop)

        await asyncio.gather(*(one_student(slot) for slot in range(students)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--students", type=int, default=10, help="studying at the same moment")
    parser.add_argument("--seconds", type=float, default=120)
    parser.add_argument("--cpu", type=float, default=0.1, help="the server's share of one CPU")
    parser.add_argument("--db-delay-ms", type=float, default=2, help="API to database, each way")
    parser.add_argument("--population", type=int, default=1000)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    url = load_url()
    database = url.rsplit("/", 1)[1].split("?")[0]
    from_db: Synchronized[int] = multiprocessing.Value("Q", 0)
    to_db: Synchronized[int] = multiprocessing.Value("Q", 0)
    db_proxy = multiprocessing.Process(
        target=proxy, args=(5432, args.db_delay_ms / 1000, from_db, to_db), daemon=True
    )
    db_proxy.start()
    environment = os.environ | {
        "DATABASE_URL": f"postgresql+psycopg://localhost:{PROXY_PORT}/{database}",
        "AUTH_MODE": "dev",
        "ENVIRONMENT": "development",
        "ATTEMPTS_PER_MINUTE": "100000",
    }
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--port",
            str(PORT),
            "--log-level",
            "warning",
        ],
        env=environment,
        stdout=subprocess.DEVNULL,
    )
    limiter = None
    try:
        booted = time.monotonic()
        if args.cpu < 1:
            limiter = multiprocessing.Process(
                target=throttle, args=(server.pid, args.cpu), daemon=True
            )
            limiter.start()
        for _ in range(1200):
            try:
                if httpx2.get(f"http://localhost:{PORT}/api/health/ready", timeout=30).is_success:
                    break
            except httpx2.HTTPError:
                time.sleep(0.25)
        boot_seconds = time.monotonic() - booted

        cpu_before, _ = process_usage(server.pid)
        db_before = database_cpu(database)
        from_db.value = to_db.value = 0
        stats = Stats()
        started = time.monotonic()
        asyncio.run(drive(args.students, args.seconds, args.population, stats))
        elapsed = time.monotonic() - started
        cpu_after, rss = process_usage(server.pid)
        requests = sum(len(values) for values in stats.times.values())
        result = {
            "students": args.students,
            "cpu_share": args.cpu,
            "seconds": round(elapsed),
            "boot_seconds": round(boot_seconds, 1),
            "requests": requests,
            "requests_per_second": round(requests / elapsed, 1),
            "lessons_finished": stats.lessons,
            "failures": sum(stats.failures.values()),
            "refused_then_retried": stats.refused,
            "server_cpu_seconds": round(cpu_after - cpu_before, 1),
            "server_cpu_used_share": round((cpu_after - cpu_before) / elapsed, 3),
            "server_cpu_ms_per_request": round(
                (cpu_after - cpu_before) / max(requests, 1) * 1000, 1
            ),
            "server_memory_mb": round(rss),
            "database_cpu_seconds": round(database_cpu(database) - db_before, 1),
            "database_egress_mb": round(from_db.value / 1e6, 1),
            "database_egress_kb_per_request": round(from_db.value / 1e3 / max(requests, 1), 1),
            "api_response_mb": round(stats.bytes / 1e6, 1),
            "endpoints": stats.report(),
        }
        print(json.dumps(result, indent=1, ensure_ascii=False))
        if args.out:
            with open(args.out, "a") as file:
                file.write(json.dumps(result, ensure_ascii=False) + "\n")
    finally:
        if limiter is not None:
            limiter.terminate()
            limiter.join()
        os.kill(server.pid, signal.SIGCONT)
        server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()  # after an overload it may still be working through abandoned requests
            server.wait()
        db_proxy.terminate()


if __name__ == "__main__":
    main()
