"""Nothing in the database is reachable through Supabase's Data API (ADR 0058).

The publishable key is in every browser, and Supabase serves the `public` schema over REST to
whoever holds it. FastAPI is the only way in: every table has row-level security with no policies,
and the API's roles hold no privileges. A table added later without RLS fails here.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

API_ROLES = ("anon", "authenticated")


def test_every_table_has_row_level_security(db: Session) -> None:
    open_tables = db.scalars(
        text(
            "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace"
            " AND relkind IN ('r', 'p') AND NOT relrowsecurity ORDER BY relname"
        )
    ).all()
    assert open_tables == []


@pytest.mark.parametrize("role", API_ROLES)
def test_the_api_roles_hold_no_privileges(db: Session, role: str) -> None:
    granted = db.scalars(
        text(
            "SELECT c.relname FROM pg_class c"
            " WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v')"
            " AND (has_table_privilege(:role, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')"
            " OR (c.relkind = 'S' AND has_sequence_privilege(:role, c.oid, 'USAGE, SELECT')))"
        ),
        {"role": role},
    ).all()
    assert granted == []
    # Nor will a table made later inherit any.
    defaults = db.scalars(
        text(
            "SELECT defaclobjtype FROM pg_default_acl d, aclexplode(d.defaclacl) a"
            " WHERE d.defaclnamespace = 'public'::regnamespace"
            " AND a.grantee = CAST(:role AS regrole)"
        ),
        {"role": role},
    ).all()
    assert defaults == []


def test_the_anonymous_role_can_read_nothing(db: Session) -> None:
    db.execute(text("SET LOCAL ROLE anon"))
    with pytest.raises(DBAPIError, match="permission denied"):
        db.execute(text("SELECT count(*) FROM users"))
    db.rollback()
