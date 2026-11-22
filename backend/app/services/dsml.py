"""DeepSeek sometimes writes a tool call into its answer as text, in its own markup, instead of as a
tool call (seen in the live evals, 22 November 2026, about 1 answer in 5 after several tools):

    <｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="show">
    <｜｜DSML｜｜ parameter name="component" string="true">day</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
    </｜｜DSML｜｜ calls>

The learner must never see that. `Guard` lets the answer's text through as it streams and holds
everything from the first special token on (DeepSeek's special tokens all begin «<｜», which never
occurs in a real answer); `calls` reads the tool calls out of what was held, so they can be run.
"""

import json
import re
from typing import Any

MARK = "<｜"


class Guard:
    """Text that is safe to show, chunk by chunk; the markup, kept aside."""

    def __init__(self) -> None:
        self.markup = ""
        self._held = ""
        self._in_markup = False

    def feed(self, text: str) -> str:
        if self._in_markup:
            self.markup += text
            return ""
        text = self._held + text
        self._held = ""
        at = text.find(MARK)
        if at >= 0:
            self._in_markup = True
            self.markup = text[at:]
            return text[:at]
        # A chunk may end halfway through the mark: hold its «<» until the next one shows.
        if text.endswith("<"):
            self._held = "<"
            return text[:-1]
        return text

    def end(self) -> str:
        """What is still held at the end of the stream: a «<» that began nothing."""
        held, self._held = self._held, ""
        return held


_INVOKE = re.compile(r'invoke name="([^"]+)"\s*>(.*?)</[^>]*?invoke\s*>', re.S)
_PARAM = re.compile(
    r'parameter name="([^"]+)"(?:\s+string="(true|false)")?\s*>(.*?)</[^>]*?parameter\s*>', re.S
)


def calls(markup: str) -> list[tuple[str, dict[str, Any]]]:
    """The tool calls written in the markup, as (name, arguments); nothing if there are none."""
    found: list[tuple[str, dict[str, Any]]] = []
    for name, body in _INVOKE.findall(markup):
        args: dict[str, Any] = {}
        for key, is_string, value in _PARAM.findall(body):
            if is_string == "false":
                try:
                    args[key] = json.loads(value)
                except ValueError:
                    args[key] = value
            else:
                args[key] = value
        found.append((name.strip(), args))
    return found
