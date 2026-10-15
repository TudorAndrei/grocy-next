"""Preserve the permission row counter when upgrading a project database."""

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from grocy.core.config import clear_settings_cache
from grocy.db.compatibility_views import install_compatibility_views
from grocy.db.models import Base
from grocy.db.session import reset_engine
from grocy.main import create_app


def test_existing_permission_rows_keep_their_counter_after_replacement(tmp_path: Path, monkeypatch):
    database = tmp_path / "permissions.db"
    engine = create_engine(f"sqlite:///{database}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE user_permissions")
        # The stored revision 0012 used an ordinary integer primary key here.
        connection.exec_driver_sql("""
            CREATE TABLE user_permissions (
                id INTEGER NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                permission_id INTEGER NOT NULL,
                UNIQUE(user_id, permission_id)
            )
        """)
        install_compatibility_views(connection)
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('20261015_0012')")
    engine.dispose()
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            CREATE VIEW saved_permissions AS
                SELECT id, user_id, permission_id FROM user_permissions;
            CREATE INDEX saved_permission_index ON user_permissions(permission_id);
            CREATE TABLE permission_audit (permission_row_id INTEGER);
            CREATE TRIGGER saved_permission_insert AFTER INSERT ON user_permissions BEGIN
                INSERT INTO permission_audit VALUES (NEW.id);
            END;
        """)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "false")
    clear_settings_cache()
    headers = {"GROCY-API-KEY": "dev-key"}
    with TestClient(create_app(), headers=headers) as old:
        assert (
            old.post("/api/users", json={"username": "Legacy", "password": "test"}).status_code
            == 204
        )
        user = old.get("/api/users", params={"query[]": "username=Legacy"}).json()[0]["id"]
        path = f"/api/users/{user}/permissions"
        previous = old.get(path).json()[0]["id"]
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "true")
    clear_settings_cache()
    reset_engine()
    with TestClient(create_app(), headers=headers) as upgraded:
        assert upgraded.put(path, json={"permissions": []}).status_code == 204
        assert upgraded.post(path, json={"permission_id": 7}).status_code == 204
        assert upgraded.get(path).json() == [
            {"id": previous + 1, "user_id": user, "permission_id": 7}
        ]
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT id, permission_id FROM saved_permissions WHERE user_id=?", (user,)
        ).fetchone() == (previous + 1, 7)
        assert connection.execute(
            "SELECT permission_row_id FROM permission_audit ORDER BY rowid DESC LIMIT 1"
        ).fetchone() == (previous + 1,)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name='saved_permission_index'"
        ).fetchone() == ("saved_permission_index",)
