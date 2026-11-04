# One image: the built web app plus the API that serves it (ADR 0009).
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Public values, baked into the bundle at build time (the publishable key is safe in a browser).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_AUTH_MODE=supabase VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/ ./
COPY content/ /app/content/
COPY --from=web /web/dist /app/web-dist
RUN useradd --system --uid 10001 app && chown -R app /app
USER app
ENV ENVIRONMENT=production AUTH_MODE=jwt WEB_DIST=/app/web-dist PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 8000
# Migrations run before the server starts; they need DATABASE_URL, AUTH_ISSUER and
# SUPABASE_SECRET_KEY at runtime.
CMD ["sh", "-c", "alembic upgrade head && python -m app.cli load-content /app/content/a1-a2 /app/content/b1-b2 /app/content/c1 && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
