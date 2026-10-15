"""Keep saved project data when upgrading user references from revision 0011."""

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from grocy.core.config import clear_settings_cache
from grocy.db.compatibility_views import install_compatibility_views
from grocy.db.models import Base
from grocy.db.session import reset_engine
from grocy.main import create_app


@pytest.mark.parametrize("upgrade_method", ["startup", "cli"])
def test_user_deletion_after_upgrade_keeps_saved_records(
    tmp_path: Path, monkeypatch, api_headers, upgrade_method
):
    database = tmp_path / "project.db"
    engine = create_engine(f"sqlite:///{database}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        for statement in (
            (Path(__file__).parents[1] / "fixtures/project-0011-user-references.sql")
            .read_text()
            .split(";")
        ):
            if statement.strip():
                connection.exec_driver_sql(statement)
        install_compatibility_views(connection)
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('20261015_0011')")
    engine.dispose()
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            CREATE INDEX ix_chores_log_performance1 ON chores_log(chore_id, undone, tracked_time);
            CREATE INDEX custom_user_name ON users(last_name);
            CREATE TABLE deleted_user_audit (user_id INTEGER);
            CREATE TRIGGER saved_user_delete AFTER DELETE ON users BEGIN
                INSERT INTO deleted_user_audit VALUES (OLD.id);
            END;
            CREATE VIEW saved_assignments AS SELECT id, assigned_to_user_id FROM tasks;
        """)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "false")
    clear_settings_cache()
    with TestClient(create_app(), headers=api_headers) as old:
        assert (
            old.post("/api/users", json={"username": "Former", "password": "test"}).status_code
            == 204
        )
        user = old.get("/api/users", params={"query[]": "username=Former"}).json()[0]["id"]
        key = old.post("/api/v2/api-keys", json={"user_id": user}).json()["api_key"]
        old.headers["GROCY-API-KEY"] = key
        assert old.put("/api/user/settings/kept", json={"value": "saved"}).status_code == 204
        booking = old.post("/api/stock/products/1/add", json={"amount": 1})
        assert booking.status_code == 200, booking.text
        task = old.post(
            "/api/objects/tasks", json={"name": "Saved task", "assigned_to_user_id": user}
        )
        assert task.status_code == 200, task.text
        chore = old.post("/api/chores/1/execute", json={"tracked_time": "2027-01-04"})
        assert chore.status_code == 200, chore.text
        proposal = old.post(
            "/api/v2/nutrition/proposals",
            json={
                "product_id": 1,
                "expected_revision": 0,
                "basis": {"quantity": "100", "unit": "g"},
                "nutrients": {"energy_kcal": "100"},
            },
        )
        assert proposal.status_code == 200, proposal.text
        committed = old.post(f"/api/v2/nutrition/proposals/{proposal.json()['id']}/approve")
        assert committed.status_code == 200, committed.text
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "true")
    reset_engine()
    clear_settings_cache()
    if upgrade_method == "cli":
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=Path(__file__).parents[2],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stdout + result.stderr
    with TestClient(create_app(), headers=api_headers) as upgraded:
        assert upgraded.get("/api/stock/products/1").status_code == 200
        invalid_task = upgraded.post(
            "/api/objects/tasks", json={"name": "Invalid category", "category_id": 2147483647}
        )
        assert invalid_task.status_code == 409, invalid_task.text
        duplicate = upgraded.post("/api/users", json={"username": "Former", "password": "test"})
        assert duplicate.status_code == 409, duplicate.text
        response = upgraded.delete(f"/api/users/{user}", headers={"GROCY-API-KEY": key})
        assert response.status_code == 204, response.text
        assert upgraded.get("/api/user", headers={"GROCY-API-KEY": key}).status_code == 401
        assert upgraded.get("/api/v2/products/1/nutrition").json()["updated_by"] == user
        assert upgraded.get("/api/v2/products/1/nutrition/revisions").json()[0]["actor_id"] == user
        assert (
            upgraded.post("/api/users", json={"username": "Next", "password": "test"}).status_code
            == 204
        )
        next_user = upgraded.get("/api/users", params={"query[]": "username=Next"}).json()[0]["id"]
        assert next_user > user
        assert upgraded.get("/api/user", headers={"GROCY-API-KEY": key}).status_code == 401
        assert upgraded.get("/api/stock/products/1").status_code == 200
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT user_id FROM api_keys WHERE api_key=?", (key,)
        ).fetchone() == (user,)
        assert connection.execute(
            "SELECT user_id, value FROM user_settings WHERE key='kept'"
        ).fetchone() == (user, "saved")
        assert connection.execute(
            "SELECT permission_id FROM user_permissions WHERE user_id=?", (user,)
        ).fetchall() == [(1,)]
        assert connection.execute("SELECT user_id FROM deleted_user_audit").fetchall() == [(user,)]
        assert connection.execute(
            "SELECT assigned_to_user_id FROM saved_assignments WHERE id=?",
            (task.json()["created_object_id"],),
        ).fetchone() == (user,)
        assert connection.execute(
            "SELECT done_by_user_id, tracked_time FROM chores_log WHERE id=?", (chore.json()["id"],)
        ).fetchone() == (user, "2027-01-04")
        assert connection.execute(
            "SELECT user_id FROM stock_log WHERE id=?", (booking.json()[0]["id"],)
        ).fetchone() == (user,)
        assert connection.execute("SELECT contributor_id FROM nutrition_evidence").fetchall() == [
            (user,)
        ]
        assert connection.execute(
            "SELECT created_by, approved_by FROM nutrition_proposals"
        ).fetchall() == [(user, user)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='custom_user_name'"
        ).fetchone() == ("custom_user_name",)


def test_deleted_last_user_stays_deleted_after_restart(tmp_path: Path, monkeypatch, api_headers):
    database = tmp_path / "last-user.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    clear_settings_cache()
    with TestClient(create_app(), headers=api_headers) as app:
        assert app.delete("/api/users/1").status_code == 204
        assert app.get("/api/user").status_code == 401
    reset_engine()
    clear_settings_cache()
    with TestClient(create_app(), headers=api_headers) as restarted:
        assert restarted.get("/api/user").status_code == 401
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone() == (0,)
        assert connection.execute(
            "SELECT user_id FROM api_keys WHERE api_key='dev-key'"
        ).fetchone() == (1,)
