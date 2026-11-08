"""The native minute poll observes committed business writes, not credential use."""

import os
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from grocy.core.config import clear_settings_cache
from grocy.core.time import server_timezone
from grocy.db.session import get_engine, get_session_factory
from grocy.main import create_app


@pytest.fixture(params=[False, True], ids=["rollback-journal", "wal"])
def database_api(request, tmp_path, monkeypatch):
    path = tmp_path / "change-signal.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{path}")
    monkeypatch.setenv("GROCY_DATABASE_WAL", str(request.param).lower())
    clear_settings_cache()
    with TestClient(create_app()) as api:
        api.options("/api/system/info")
        with sqlite3.connect(path) as connection:
            connection.execute(
                "INSERT INTO api_keys(api_key,user_id,expires,key_type) "
                "VALUES ('native-change-key',1,'2999-12-31 23:59:59','default')"
            )
            connection.execute(
                "INSERT INTO api_keys(api_key,user_id,expires,key_type) "
                "VALUES ('modern-change-key',1,'2999-12-31 23:59:59','grocy-next')"
            )
            connection.execute(
                "INSERT INTO sessions(session_key,user_id,expires) "
                "VALUES ('change-session',1,'2999-12-31 23:59:59')"
            )
        yield api, path


def stamp(path, value=None):
    seconds = int(time.time()) - 7 * 86400 if value is None else value
    os.utime(path, (seconds, seconds))
    return datetime.fromtimestamp(seconds, server_timezone()).strftime("%Y-%m-%d %H:%M:%S")


def changed(api):
    response = api.get(
        "/api/system/db-changed-time", headers={"GROCY-API-KEY": "native-change-key"}
    )
    assert response.status_code == 200, response.text
    return response.json()["changed_time"]


def test_committed_http_product_write_advances_the_native_change_signal(database_api):
    api, path = database_api
    before = stamp(path)
    assert changed(api) == before
    response = api.put(
        "/api/objects/products/1",
        headers={"GROCY-API-KEY": "native-change-key"},
        json={"name": "Committed database-change coffee"},
    )
    assert response.status_code == 204, response.text
    assert (
        api.get("/api/objects/products/1", headers={"GROCY-API-KEY": "native-change-key"}).json()[
            "name"
        ]
        == "Committed database-change coffee"
    )
    after = changed(api)
    assert after > before
    assert after == datetime.fromtimestamp(path.stat().st_mtime, server_timezone()).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    # Reads may update last_used (and the WAL), but must retain the published signal.
    assert changed(api) == after


def test_native_session_and_both_key_read_paths_preserve_external_file_time(database_api):
    api, path = database_api
    before = stamp(path)
    original = path.stat().st_mtime_ns
    for route, headers in [
        ("/api/user", {"GROCY-API-KEY": "native-change-key"}),
        ("/api/v2/user/permissions", {"GROCY-API-KEY": "modern-change-key"}),
        ("/api/user", {"Cookie": "grocy_session=change-session"}),
    ]:
        for _ in range(2):
            response = api.get(route, headers=headers)
            assert response.status_code == 200, response.text
            assert path.stat().st_mtime_ns == original
            assert changed(api) == before
    with sqlite3.connect(path) as connection:
        assert all(
            row[0]
            for row in connection.execute(
                "SELECT last_used FROM api_keys WHERE api_key IN "
                "('native-change-key','modern-change-key')"
            )
        )
        assert connection.execute(
            "SELECT last_used FROM sessions WHERE session_key='change-session'"
        ).fetchone()[0]
    # Direct file timestamp changes remain authoritative; no in-memory marker masks them.
    external = stamp(path, int(time.time()) - 3 * 86400)
    assert changed(api) == external


def test_rollback_and_empty_commits_do_not_publish_changes(database_api):
    api, path = database_api
    before = stamp(path)
    original = path.stat().st_mtime_ns

    async def transactions():
        async with get_session_factory()() as session:
            name = await session.scalar(text("SELECT name FROM products WHERE id=1"))
            await session.execute(text("UPDATE products SET name='Must roll back' WHERE id=1"))
            await session.rollback()
            assert await session.scalar(text("SELECT name FROM products WHERE id=1")) == name
            await session.commit()
            await session.execute(text("UPDATE products SET name='Missing' WHERE id=-99999"))
            await session.commit()
            # Equal-value writes count in SQLite total_changes but write no pages.
            await session.execute(text("UPDATE locations SET description=description WHERE id=1"))
            await session.commit()

    api.portal.call(transactions)
    assert path.stat().st_mtime_ns == original
    assert changed(api) == before


def test_savepoint_rollback_and_pooled_engine_reads_leave_no_stale_change_owner(database_api):
    api, path = database_api
    before = stamp(path)

    async def transactions():
        async with get_session_factory()() as session:
            await session.execute(text("BEGIN"))
            nested = await session.begin_nested()
            await session.execute(text("UPDATE locations SET name='Discarded' WHERE id=1"))
            await nested.rollback()
            await session.commit()
        async with get_engine().connect() as connection:
            assert await connection.scalar(text("SELECT 1")) == 1

    api.portal.call(transactions)
    assert changed(api) == before

    async def explicit_commit():
        async with get_session_factory()() as session:
            await session.execute(text("BEGIN"))
            nested = await session.begin_nested()
            deeper = await session.begin_nested()
            await session.execute(text("UPDATE locations SET name='Discarded inner' WHERE id=1"))
            await deeper.rollback()
            await nested.rollback()
            await session.execute(text("UPDATE locations SET name='Kept outer' WHERE id=1"))
            connection = await session.connection()
            await connection.exec_driver_sql("COMMIT")
            await session.commit()

    api.portal.call(explicit_commit)
    assert changed(api) > before
    assert (
        api.get("/api/objects/locations/1", headers={"GROCY-API-KEY": "native-change-key"}).json()[
            "name"
        ]
        == "Kept outer"
    )


def test_queued_authentication_cannot_backdate_another_process_business_commit(database_api):
    flock = pytest.importorskip("fcntl")
    api, path = database_api
    before = stamp(path)
    attempted = threading.Event()
    engine = api.portal.call(lambda: get_engine().sync_engine)

    def authentication_update(_connection, _cursor, statement, _params, _context, _many):
        if statement.startswith("UPDATE api_keys SET last_used="):
            attempted.set()

    event.listen(engine, "before_cursor_execute", authentication_update)
    script = """
import asyncio
from sqlalchemy import text
from grocy.db.session import get_engine, get_session_factory
async def write():
    async with get_session_factory()() as session:
        await session.execute(text("UPDATE products SET name='Other worker commit' WHERE id=1"))
        print('staged', flush=True)
        await session.commit()
    await get_engine().dispose()
asyncio.run(write())
"""
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).parents[2] / "src")}
    descriptor = os.open(path, os.O_RDONLY)
    flock.flock(descriptor, flock.LOCK_EX)
    process = subprocess.Popen(
        [sys.executable, "-c", script],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "staged"
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                api.get, "/api/user", headers={"GROCY-API-KEY": "native-change-key"}
            )
            try:
                assert attempted.wait(timeout=10)
            finally:
                flock.flock(descriptor, flock.LOCK_UN)
            assert pending.result(timeout=10).status_code == 200
        _stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 0, stderr
        assert changed(api) > before
        assert (
            api.get(
                "/api/objects/products/1", headers={"GROCY-API-KEY": "native-change-key"}
            ).json()["name"]
            == "Other worker commit"
        )
    finally:
        os.close(descriptor)
        event.remove(engine, "before_cursor_execute", authentication_update)
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


def test_publication_failure_does_not_report_a_failed_durable_write_or_leak_the_lock(
    database_api, monkeypatch, caplog
):
    api, path = database_api
    before = stamp(path)

    def unavailable(*_args, **_kwargs):
        raise PermissionError("Disposable timestamp publication failure")

    with monkeypatch.context() as failure:
        failure.setattr(os, "utime", unavailable)
        response = api.put(
            "/api/objects/products/1",
            headers={"GROCY-API-KEY": "native-change-key"},
            json={"name": "Durable despite notification failure"},
        )
        assert response.status_code == 204, response.text
    assert "Could not publish committed database change time" in caplog.text
    assert (
        api.get("/api/objects/products/1", headers={"GROCY-API-KEY": "native-change-key"}).json()[
            "name"
        ]
        == "Durable despite notification failure"
    )
    # A subsequent successful business commit recovers the signal and can acquire
    # the same publication lock after the failed filesystem operation.
    response = api.put(
        "/api/objects/products/1",
        headers={"GROCY-API-KEY": "native-change-key"},
        json={"name": "Recovered database change notification"},
    )
    assert response.status_code == 204, response.text
    assert changed(api) > before
