# Architecture decision records

One file per decision that is costly to reverse or easy to second-guess. Format: context, decision, consequences. Supersede a record with a new one instead of editing history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-repository-layout.md) | Keep `web/`; add `backend/` and `content/` beside it | Accepted |
| [0002](0002-backend-stack.md) | FastAPI, SQLAlchemy 2, Alembic, psycopg 3, uv | Accepted |
| [0003](0003-server-side-answer-evaluation.md) | The server evaluates answers; one attempt per exercise | Accepted |
| [0004](0004-auth-seam.md) | Auth seam with a development user until a provider is chosen | Accepted |
| [0005](0005-content-as-yaml.md) | Vocabulary as version-controlled YAML with a validated import | Accepted |
| [0006](0006-leitner-scheduler.md) | Leitner-style review scheduler (1/3/7/16/35 days) | Superseded by 0012 |
| [0007](0007-dev-clock-and-server-time.md) | Development clock override; day labels from server time | Accepted |
| [0008](0008-points-goal-streak.md) | Points, daily goal and streaks reward evidence of learning | Goal and streak superseded by 0015 |
| [0009](0009-supabase-auth.md) | Supabase Auth with local JWT verification; one container for API and web | Accepted |
| [0010](0010-pace-and-course-goal.md) | A sourced course goal; a daily pace the learner picks and the app tunes | Accepted |
| [0011](0011-friend-groups-and-board.md) | Friend groups with a weekly board that rewards showing up | Accepted |
| [0012](0012-anki-style-flashcards-fsrs.md) | Anki-style flashcards scheduled by FSRS | Accepted |
| [0013](0013-recorded-audio-and-tap-a-word.md) | Recorded neural-voice audio; every example word tappable | Accepted |
| [0014](0014-course-levels-and-anki-deck-list.md) | Level decks, later ones locked; Anki-style counts and a «Today» home | Accepted |
| [0015](0015-plan-days.md) | Plan days: consistency against the learner's own promise | Accepted |
| [0016](0016-spelling-with-letter-tiles.md) | Spelling with letter tiles: guided, then recall, in the daily lesson | Accepted |
