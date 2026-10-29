"""Cumulative text coverage of the NGSL by rank, from the list's own frequency data.

    curl -sLO https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv
    python3 content/tools/ngsl_coverage.py NGSL_12_stats.csv

"Adjusted Frequency per Million (U)" counts every inflected form of a lemma, so the running sum
divided by 1,000,000 is the share of running words in the NGSL corpus covered by the top N lemmas.
The CSV is not committed: it is published by the NGSL project (CC BY-SA 4.0) and easy to fetch.
"""

import csv
import sys

TARGETS = (50, 60, 70, 75, 80, 85)
CHECKPOINTS = (100, 500, 1000, 1300, 1500, 2000)


def main(path: str) -> None:
    with open(path, encoding="utf-8") as file:
        rows = sorted(csv.DictReader(file), key=lambda row: int(row["SFI Rank"]))
    total = 0.0
    reached: dict[int, int] = {}
    for rank, row in enumerate(rows, start=1):
        total += float(row["Adjusted Frequency per Million (U)"])
        coverage = total / 10_000
        for target in TARGETS:
            if target not in reached and coverage >= target:
                reached[target] = rank
        if rank in CHECKPOINTS or rank == len(rows):
            print(f"top {rank:>5} words: {coverage:5.1f}%")
    for target, rank in reached.items():
        print(f"{target}% reached at word {rank}")


if __name__ == "__main__":
    main(sys.argv[1])
