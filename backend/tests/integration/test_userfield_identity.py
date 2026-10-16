"""Verify native custom value retention and the legacy field identity upgrade."""

import sqlite3
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from grocy.core.config import clear_settings_cache
from grocy.db.compatibility_views import install_compatibility_views
from grocy.main import create_app


def test_native_value_deletion_keeps_orphans_and_empty_write_allocation(
    tmp_path: Path, monkeypatch
):
    database = tmp_path / "fields.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    clear_settings_cache()
    with TestClient(create_app(), headers={"GROCY-API-KEY": "dev-key"}) as api:
        api.options("/api/system/info")
        body = {
            "entity": "locations",
            "name": "saved",
            "caption": "Saved",
            "type": "text-single-line",
        }
        field = int(api.post("/api/objects/userfields", json=body).json()["created_object_id"])
        assert (
            api.put(f"/api/userfields/locations/{field}", json={"saved": "Matching"}).status_code
            == 204
        )
        assert (
            api.put("/api/userfields/locations/other", json={"saved": "Retained"}).status_code
            == 204
        )
        assert api.delete(f"/api/objects/userfields/{field}").status_code == 204
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT field_id,object_id,value FROM userfield_values"
            ).fetchall() == [(field, "other", "Retained")]
        replacement = int(
            api.post("/api/objects/userfields", json=body).json()["created_object_id"]
        )
        assert replacement == field + 1
        assert api.get("/api/userfields/locations/other").json() == {"saved": None}
        assert api.put("/api/userfields/locations/other", json={"saved": "New"}).status_code == 204
        assert api.put("/api/userfields/locations/empty", json={"saved": None}).status_code == 204
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT field_id,object_id,value FROM userfield_values ORDER BY id"
            ).fetchall() == [(field, "other", "Retained"), (replacement, "other", "New")]
            assert db.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='userfield_values'"
            ).fetchone() == (4,)


def _legacy_fields(database: Path, monkeypatch, *, integer_only: bool = False) -> None:
    with sqlite3.connect(database) as db:
        schema = (Path(__file__).parents[1] / "fixtures/project-0013-counters.sql").read_text()
        if integer_only:
            schema = schema.replace(
                "object_id INTEGER NOT NULL,",
                "object_id INTEGER NOT NULL CHECK(typeof(object_id)='integer'),",
            )
        db.executescript(schema)
        db.executescript("""
            CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);
            INSERT INTO alembic_version VALUES ('20261015_0013');
        """)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        install_compatibility_views(connection)
    engine.dispose()
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "20261015_0017"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(database) as db:
        db.executescript("""
            INSERT INTO userfields
                (id,entity,name,caption,type,input_required,show_as_column_in_tables,sort_number)
                VALUES (10,'locations','kept','Kept','text-single-line',0,0,0);
            INSERT INTO userfield_values (id,entity,object_id,name,value,row_created_timestamp)
                VALUES (20,'locations',1,'kept','Saved','2026-01-02 03:04:05');
            INSERT INTO userfield_values (id,entity,object_id,name,value)
                VALUES (21,'locations',1,'ghost','Retained'),
                       (22,'locations',2,'kept',NULL),(23,'locations',3,'kept','');
            UPDATE sqlite_sequence SET seq=4000 WHERE name='userfield_values';
            CREATE VIEW saved_values AS SELECT entity,name,value FROM userfield_values;
            CREATE INDEX saved_value_index ON userfield_values(value);
            CREATE TABLE value_audit (name TEXT,value TEXT);
            CREATE TRIGGER saved_value_update AFTER UPDATE ON userfield_values BEGIN
                INSERT INTO value_audit VALUES (NEW.name,NEW.value);
            END;
        """)


def test_legacy_field_upgrade_keeps_values_counters_and_custom_sql(tmp_path: Path, monkeypatch):
    database = tmp_path / "legacy.db"
    _legacy_fields(database, monkeypatch)
    clear_settings_cache()
    with TestClient(create_app(), headers={"GROCY-API-KEY": "dev-key"}) as api:
        api.options("/api/system/info")
        with sqlite3.connect(database) as db:
            rows = db.execute(
                "SELECT id,field_id,object_id,value FROM userfield_values ORDER BY id"
            ).fetchall()
            assert rows[0] == (20, 10, "1", "Saved")
            assert rows[1][0] == 21 and rows[1][1] < 0 and rows[1][2:] == ("1", "Retained")
            assert len(rows) == 2
            assert db.execute(
                "SELECT row_created_timestamp FROM userfield_values WHERE id=20"
            ).fetchone() == ("2026-01-02 03:04:05",)
            assert db.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='userfield_values'"
            ).fetchone() == (4000,)
            assert db.execute("SELECT * FROM value_audit").fetchall() == []
        assert api.put("/api/objects/userfields/10", json={"name": "changed"}).status_code == 204
        assert api.get("/api/userfields/locations/1").json()["changed"] == "Saved"
        assert (
            api.put("/api/userfields/locations/1", json={"changed": "Updated"}).status_code == 204
        )
        field = api.post(
            "/api/objects/userfields",
            json={
                "entity": "locations",
                "name": "ghost",
                "caption": "Ghost",
                "type": "text-single-line",
            },
        )
        assert field.status_code == 200, field.text
        assert api.get("/api/userfields/locations/1").json()["ghost"] is None
        assert api.put("/api/userfields/locations/1", json={"ghost": "New"}).status_code == 204
        with sqlite3.connect(database) as db:
            assert db.execute("SELECT id FROM userfield_values WHERE value='New'").fetchone() == (
                4001,
            )
            assert db.execute("SELECT * FROM value_audit").fetchall() == [("kept", "Updated")]
            assert db.execute("SELECT COUNT(*) FROM saved_values").fetchone() == (3,)
            assert db.execute(
                "SELECT name FROM sqlite_master WHERE name='saved_value_index'"
            ).fetchone() == ("saved_value_index",)
            assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_failed_identity_upgrade_restores_schema_values_and_counters(tmp_path: Path, monkeypatch):
    database = tmp_path / "failed.db"
    _legacy_fields(database, monkeypatch, integer_only=True)

    def saved_state():
        with sqlite3.connect(database) as db:
            schema = db.execute(
                "SELECT type,name,sql FROM sqlite_master ORDER BY type,name"
            ).fetchall()
            rows = {
                name: db.execute(f'SELECT * FROM "{name}" ORDER BY rowid').fetchall()
                for kind, name, _sql in schema
                if kind == "table"
            }
            return schema, rows

    before = saved_state()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "CHECK constraint failed" in result.stderr
    assert saved_state() == before
