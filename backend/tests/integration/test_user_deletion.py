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
        # Store the legacy user before the native permission views exist.
        old.options("/api/system/info")
        with sqlite3.connect(database) as connection:
            user = connection.execute(
                "INSERT INTO users(username,password,row_created_timestamp) VALUES ('Former','',?)",
                ("2026-01-04 12:34:56",),
            ).lastrowid
            assert user is not None
            connection.execute(
                "INSERT INTO user_permissions(user_id,permission_id) VALUES (?,1)", (user,)
            )
        key = old.post("/api/v2/api-keys", json={"user_id": user}).json()["api_key"]
        old.headers["GROCY-API-KEY"] = key
        assert old.put("/api/user/settings/kept", json={"value": "saved"}).status_code == 204
        # Store legacy stock before the native permission views exist.
        with sqlite3.connect(database) as connection:
            connection.execute(
                "INSERT INTO stock(product_id,amount,best_before_date,purchased_date,stock_id,"
                "open,location_id) VALUES (1,1,'2027-12-31','2027-01-04','saved-stock',0,1)"
            )
            booking_id = connection.execute(
                "INSERT INTO stock_log(product_id,amount,best_before_date,purchased_date,stock_id,"
                "spoiled,transaction_type,undone,location_id,transaction_id,user_id) "
                "VALUES (1,1,'2027-12-31','2027-01-04','saved-stock',0,'purchase',0,1,"
                "'saved-purchase',?)",
                (user,),
            ).lastrowid
        # The saved schema has no native API permission views before the upgrade.
        with sqlite3.connect(database) as connection:
            task = connection.execute(
                "INSERT INTO tasks(name,assigned_to_user_id,done) VALUES ('Saved task',?,0)",
                (user,),
            ).lastrowid
            chore_log = connection.execute(
                "INSERT INTO chores_log(chore_id,tracked_time,done_by_user_id,skipped,undone) "
                "VALUES (1,'2027-01-04',?,0,0)",
                (user,),
            ).lastrowid
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
        upgraded.options("/api/system/info")
        assert upgraded.get("/api/stock/products/1").status_code == 200
        invalid_task = upgraded.post(
            "/api/objects/tasks", json={"name": "Invalid completion", "done": 2}
        )
        assert invalid_task.status_code == 400, invalid_task.text
        duplicate = upgraded.post("/api/users", json={"username": "Former", "password": "test"})
        assert duplicate.status_code == 400, duplicate.text
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
            (task,),
        ).fetchone() == (user,)
        assert connection.execute(
            "SELECT done_by_user_id, tracked_time FROM chores_log WHERE id=?", (chore_log,)
        ).fetchone() == (user, "2027-01-04")
        assert connection.execute(
            "SELECT user_id FROM stock_log WHERE id=?", (booking_id,)
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
        app.options("/api/system/info")
        assert app.delete("/api/users/1").status_code == 204
        assert app.get("/api/user").status_code == 401
    reset_engine()
    clear_settings_cache()
    with TestClient(create_app(), headers=api_headers) as restarted:
        restarted.options("/api/system/info")
        assert restarted.get("/api/user").status_code == 401
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone() == (0,)
        assert connection.execute(
            "SELECT user_id FROM api_keys WHERE api_key='dev-key'"
        ).fetchone() == (1,)
