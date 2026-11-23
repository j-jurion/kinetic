# Kinetic API for Fly.io. The web app is deployed separately on Vercel (see DEPLOYMENT.md).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies first so code changes don't reinstall them
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY run.py ./

RUN useradd --system --uid 10001 --home-dir /app kinetic

ENV PATH="/app/.venv/bin:$PATH" \
    KINETIC_API_HOST=0.0.0.0 \
    KINETIC_API_PORT=8080

EXPOSE 8080
# Fly mounts the volume at /data owned by root: hand the data folders to the app user, then
# drop root before starting the API.
CMD ["sh", "-c", "mkdir -p /data/uploads /data/garmin_tokens && chown -R kinetic:kinetic /data && chmod 700 /data/garmin_tokens && exec setpriv --reuid=kinetic --regid=kinetic --init-groups python run.py"]
