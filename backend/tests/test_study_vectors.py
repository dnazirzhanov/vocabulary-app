"""The device's study engine is checked against cases made from this code (ADR 0062). If the
rules change here, the cases change too: this fails until they are written again
(`uv run python -m tests.study_vectors`), and then the web tests show where the device differs."""

from tests.study_vectors import OUT, render


def test_the_devices_cases_are_the_servers_rules_as_they_are() -> None:
    assert OUT.read_text() == render(), (
        "web/src/study/vectors.json is out of date: run `uv run python -m tests.study_vectors`"
    )
