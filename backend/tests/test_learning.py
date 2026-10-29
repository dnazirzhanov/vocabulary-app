"""Session queue rules (ADR 0012): due cards first, then new words; forgotten cards come back."""

from app.services.learning import MAX_SHOWINGS_PER_SESSION, pick_new_words, plan_cards, requeue


def test_new_words_come_in_deck_order_and_skip_known_ones() -> None:
    assert pick_new_words(["a", "b", "c", "d"], {"b"}, 2) == ["a", "c"]


def test_due_cards_come_before_new_ones() -> None:
    plan = plan_cards(["old1", "old2"], ["new1"])
    assert [(step.id, step.word_id, step.new) for step in plan] == [
        ("c1", "old1", False),
        ("c2", "old2", False),
        ("c3", "new1", True),
    ]


def test_a_forgotten_card_returns_a_few_cards_later_as_another_showing() -> None:
    plan = plan_cards([], ["a", "b", "c", "d", "e"])
    requeued = requeue(plan, 0, "a")
    assert requeued is not None
    new_plan, again = requeued
    assert [step.word_id for step in new_plan] == ["a", "b", "c", "d", "a", "e"]
    assert (again.id, again.new) == ("c6", False)
    # Near the end of the queue it simply goes last.
    end_plan, _ = requeue(new_plan, 5, "e") or ([], None)
    assert [step.word_id for step in end_plan][-1] == "e"


def test_a_card_is_shown_at_most_a_few_times_per_session() -> None:
    plan = plan_cards([], ["a"])
    for _ in range(MAX_SHOWINGS_PER_SESSION - 1):
        requeued = requeue(plan, len(plan) - 1, "a")
        assert requeued is not None
        plan = requeued[0]
    assert requeue(plan, len(plan) - 1, "a") is None
