# Architecture decision records

One file per decision that is costly to reverse or easy to second-guess. Format: context, decision, consequences. Supersede a record with a new one instead of editing history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-repository-layout.md) | Keep `web/`; add `backend/` and `content/` beside it | Accepted |
| [0002](0002-backend-stack.md) | FastAPI, SQLAlchemy 2, Alembic, psycopg 3, uv | Accepted |
| [0003](0003-server-side-answer-evaluation.md) | The server evaluates answers; one attempt per exercise | Accepted |
| [0004](0004-auth-seam.md) | Auth seam with a development user until a provider is chosen | Accepted |
| [0005](0005-content-as-yaml.md) | Vocabulary as version-controlled YAML with a validated import | Accepted |
| [0006](0006-leitner-scheduler.md) | Leitner-style review scheduler (1/3/7/16/35 days) | Accepted |
| [0007](0007-dev-clock-and-server-time.md) | Development clock override; day labels from server time | Accepted |
| [0008](0008-points-goal-streak.md) | Points, daily goal and streaks reward evidence of learning | Accepted |
