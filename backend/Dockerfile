FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev

ENV GROCY_HOST=0.0.0.0
ENV GROCY_PORT=8000
ENV GROCY_FILES_ROOT=/data/files
ENV GROCY_DATABASE_URL=sqlite+aiosqlite:////data/grocy.db

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "grocy"]
