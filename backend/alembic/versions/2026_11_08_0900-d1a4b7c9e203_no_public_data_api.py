"""no table is reachable through Supabase's Data API; FastAPI is the only way in (ADR 0058)

Supabase serves the `public` schema over REST to anyone holding the publishable key, which is
in every browser. The app's tables live there, so: row-level security on every table with no
policies (nothing is visible or writable to the API's roles), and no privileges for those roles,
now or on tables made later. The app connects as the tables' owner, which RLS does not restrict.

Revision ID: d1a4b7c9e203
Revises: c7e2a9d4f816
Create Date: 2026-11-08 09:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "d1a4b7c9e203"
down_revision: str | Sequence[str] | None = "c7e2a9d4f816"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `anon` and `authenticated` are Supabase's roles for requests through its Data API; they exist
# only on Supabase, so each step checks for them.


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
          END LOOP;
        END $$
        """
    )
    op.execute(
        """
        DO $$
        DECLARE r text;
        BEGIN
          FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
              EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
              EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
              EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
              EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
              EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
              EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
            END IF;
          END LOOP;
        END $$
        """
    )


def downgrade() -> None:
    # Privileges are not handed back: going back must never reopen the tables to the public.
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
          END LOOP;
        END $$
        """
    )
