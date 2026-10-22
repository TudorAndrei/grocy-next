from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from grocy.compatibility.sqlite_functions import register_sqlite_functions
from grocy.core.config import Settings, get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def reset_engine() -> None:
    global _engine, _session_factory
    _engine = None
    _session_factory = None


def _native_text(value: bytes) -> str | bytes | None:
    try:
        return value.decode() or None
    except UnicodeDecodeError:
        # PDO fetches invalid UTF-8 as bytes; JSON encoding decides whether it is valid.
        return value


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        cfg = settings or get_settings()
        connect_args: dict[str, object] = {}
        engine_kwargs: dict[str, object] = {}
        if cfg.database_url.startswith("sqlite"):
            connect_args["timeout"] = cfg.database_busy_timeout_ms / 1000
            connect_args["check_same_thread"] = False
            if ":memory:" in cfg.database_url:
                engine_kwargs["poolclass"] = StaticPool
        _engine = create_async_engine(
            cfg.database_url,
            connect_args=connect_args,
            **engine_kwargs,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
        if cfg.database_url.startswith("sqlite"):

            @event.listens_for(_engine.sync_engine, "connect")
            def configure_connection(connection: Any, _record: Any) -> None:
                register_sqlite_functions(connection)
                # Grocy uses PDO::NULL_EMPTY_STRING when it reads SQLite text.
                connection.driver_connection.text_factory = _native_text
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute(f"PRAGMA busy_timeout={cfg.database_busy_timeout_ms}")
                cursor.close()

    return _engine


def get_session_factory(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    get_engine(settings)
    assert _session_factory is not None
    return _session_factory


async def configure_sqlite(engine: AsyncEngine, settings: Settings) -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        if settings.database_wal and ":memory:" not in settings.database_url:
            await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        await conn.exec_driver_sql(f"PRAGMA busy_timeout={settings.database_busy_timeout_ms}")


async def session_scope() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


@asynccontextmanager
async def migration_connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    async with engine.connect() as connection:
        sqlite = engine.dialect.name == "sqlite"
        if sqlite:
            # SQLite batch rebuilds require this setting before the transaction starts.
            await connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            await connection.commit()
        try:
            async with connection.begin():
                if sqlite:
                    # Include DDL in the transaction, including on legacy sqlite3 control.
                    await connection.exec_driver_sql("BEGIN IMMEDIATE")

                yield connection
        finally:
            if sqlite:
                await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
                await connection.commit()


async def upgrade_schema(engine: AsyncEngine | None = None) -> None:
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    eng = engine or get_engine()
    async with migration_connection(eng) as connection:

        def upgrade(sync_connection):
            config.attributes["connection"] = sync_connection
            command.upgrade(config, "head")

        await connection.run_sync(upgrade)
