"""Text a person reads lives in core/locale.py (ADR 0055): a Russian string anywhere else in the
server would reach everyone in Russian."""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent / "app"
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
ALLOWED = {
    "core/locale.py",
    # Development only: a demo group of made-up classmates.
    "services/demo.py",
    # Matches a typed topic: «ё» and «е» are the same letter when comparing.
    "services/decks.py",
    # Prompts and example cards for the model, not for people.
    "services/generation.py",
    # Words refused in names, never shown.
    "services/decency.py",
}


def _strings(tree: ast.AST) -> list[str]:
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef)
        and node.body
        and isinstance(node.body[0], ast.Expr)
    }
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


def test_no_russian_outside_the_locale_module() -> None:
    found = {
        str(path.relative_to(ROOT)): hits
        for path in ROOT.rglob("*.py")
        if str(path.relative_to(ROOT)) not in ALLOWED
        and (hits := [s for s in _strings(ast.parse(path.read_text())) if CYRILLIC.search(s)])
    }
    assert found == {}
