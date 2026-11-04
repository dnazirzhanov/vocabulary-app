# 0005 — Vocabulary as version-controlled YAML with a validated import

**Status:** Accepted

## Context

The brief asks for structured, version-controlled content or a database with a documented import, validation of duplicates, missing translations, malformed content and broken references, and a reviewable starter deck. Russian translations will be reviewed by someone who is not a developer.

## Decision

- Content lives in `content/<deck>/deck.yaml` and `words.yaml`. YAML is chosen over JSON because reviewers can read and edit it without fighting quotes and commas.
- A Pydantic-based validator checks every rule; the import command upserts words, deck metadata and order in one transaction and is safe to re-run.
- Word ids are stable slugs chosen once (e.g. `umbrella`, `light-adj`); renaming a headword never changes its id, so learner progress survives content edits.
- CI runs the validator.

## Consequences

- Content changes go through pull requests and review, like code.
- Editing content in production means re-running the import; there is no admin UI (none is needed for a pilot).
- Removing a word from a deck keeps its row (progress references it); decks reference words by id.
