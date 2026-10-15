"""Check native SQL defaults, null values, and the saved-database upgrade."""

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache
from grocy.main import create_app


@pytest.mark.parametrize(
    "table,body,expected",
    [
        ("locations", {"name": "Direct"}, {"active": 1, "is_freezer": 0}),
        ("quantity_units", {"name": "Direct"}, {"active": 1}),
        ("tasks", {"name": "Direct"}, {"done": 0}),
        (
            "chores",
            {"name": "Direct", "period_type": "manually"},
            {"active": 1, "period_interval": 1, "track_date_only": 0, "assignment_type": None},
        ),
        (
            "userfields",
            {"entity": "locations", "name": "direct", "caption": "Direct", "type": "text"},
            {"sort_number": None, "input_required": 0, "show_as_column_in_tables": 0},
        ),
        (
            "recipes",
            {"name": "Direct"},
            {
                "base_servings": 1,
                "desired_servings": 1,
                "type": "normal",
                "not_check_shoppinglist": 0,
            },
        ),
        (
            "products",
            {"name": "Direct", "location_id": 1, "qu_id_stock": 1, "qu_id_purchase": 1},
            {"active": 1, "min_stock_amount": 0, "due_type": 1, "qu_factor_purchase_to_stock": 1},
        ),
        ("shopping_list", {"note": "Direct"}, {"amount": 0, "done": 0, "shopping_list_id": 1}),
        ("meal_plan_sections", {"name": "Direct"}, {"sort_number": None}),
    ],
)
def test_native_sql_inserts_use_database_defaults_and_allow_null_timestamps(
    tmp_path: Path, monkeypatch, table, body, expected
):
    database = tmp_path / "defaults.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    clear_settings_cache()
    with TestClient(create_app()) as api, sqlite3.connect(database) as db:
        db.row_factory = sqlite3.Row
        columns = ",".join(f'"{key}"' for key in body)
        placeholders = ",".join("?" for _key in body)
        cursor = db.execute(
            f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})', tuple(body.values())
        )
        row_id = cursor.lastrowid
        row = db.execute(f'SELECT * FROM "{table}" WHERE id=?', (row_id,)).fetchone()
        assert {key: row[key] for key in expected} == expected
        assert row["row_created_timestamp"] is not None
        db.execute(f'UPDATE "{table}" SET row_created_timestamp=NULL WHERE id=?', (row_id,))
        assert (
            db.execute(
                f'SELECT row_created_timestamp FROM "{table}" WHERE id=?', (row_id,)
            ).fetchone()[0]
            is None
        )
        db.commit()
        fetched = api.get(f"/api/objects/{table}/{row_id}", headers={"GROCY-API-KEY": "dev-key"})
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["row_created_timestamp"] is None


def _old_columns(database: Path, *, invalid_section: bool = False) -> None:
    # Saved revision 0018 column rules. Custom SQL must survive the native copy.
    with sqlite3.connect(database) as db:
        db.executescript("""
            CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);
            INSERT INTO alembic_version VALUES ('20261015_0018');
            CREATE TABLE locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
                active INTEGER NOT NULL, is_freezer INTEGER NOT NULL,
                row_created_timestamp DATETIME NOT NULL,
                project_note TEXT DEFAULT 'kept', CHECK(length(name)>0)
            );
            CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                done INTEGER NOT NULL CHECK(done IN (0,1)),
                row_created_timestamp DATETIME NOT NULL,
                project_location INTEGER REFERENCES locations(id)
            );
            CREATE TABLE meal_plan (
                id INTEGER PRIMARY KEY AUTOINCREMENT, day DATE NOT NULL,
                section_id INTEGER, done INTEGER NOT NULL
            );
            CREATE TABLE userentities (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                caption TEXT NOT NULL, show_in_sidebar_menu INTEGER NOT NULL,
                row_created_timestamp DATETIME NOT NULL
            );
            INSERT INTO locations VALUES (20,'Saved',1,0,'2026-01-02 03:04:05','Note');
            INSERT INTO tasks VALUES (30,'Saved',0,'2026-02-03 04:05:06',20);
            UPDATE sqlite_sequence SET seq=9000 WHERE name='tasks';
            CREATE INDEX task_name_lookup ON tasks(name);
            CREATE VIEW saved_task AS SELECT name,project_location FROM tasks;
            CREATE TABLE project_audit (name TEXT);
            CREATE TRIGGER task_name_audit AFTER UPDATE OF name ON tasks BEGIN
                INSERT INTO project_audit VALUES (NEW.name);
            END;
        """)
        db.execute(
            "INSERT INTO meal_plan VALUES (40,'2027-01-01',?,0)", (None if invalid_section else -1,)
        )


def _upgrade(database: Path, monkeypatch):
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_column_upgrade_keeps_rows_counters_and_custom_sql(tmp_path: Path, monkeypatch):
    database = tmp_path / "saved.db"
    _old_columns(database)
    result = _upgrade(database, monkeypatch)
    assert result.returncode == 0, result.stdout + result.stderr
    with sqlite3.connect(database) as db:
        assert (
            db.execute("SELECT seq FROM sqlite_sequence WHERE name='userentities'").fetchone()
            is None
        )
        assert db.execute("SELECT * FROM locations").fetchall() == [
            (20, "Saved", 1, 0, "2026-01-02 03:04:05", "Note")
        ]
        assert db.execute("SELECT * FROM tasks").fetchall() == [
            (30, "Saved", 0, "2026-02-03 04:05:06", 20)
        ]
        task = db.execute("INSERT INTO tasks (name,project_location) VALUES ('New',20)")
        assert task.lastrowid == 9001
        assert db.execute("SELECT done FROM tasks WHERE id=9001").fetchone() == (0,)
        assert db.execute("SELECT name FROM sqlite_master WHERE name='task_name_lookup'").fetchone()
        assert db.execute("SELECT * FROM saved_task WHERE name='Saved'").fetchone() == ("Saved", 20)
        db.execute("UPDATE tasks SET name='Changed' WHERE id=30")
        assert db.execute("SELECT * FROM project_audit").fetchall() == [("Changed",)]
        assert db.execute("PRAGMA foreign_key_list(tasks)").fetchone()[2:5] == (
            "locations",
            "project_location",
            "id",
        )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
            db.execute("INSERT INTO locations (name) VALUES ('')")
        with pytest.raises(sqlite3.IntegrityError, match="NOT NULL constraint failed"):
            db.execute("INSERT INTO meal_plan (day,section_id) VALUES ('2027-01-02',NULL)")


def test_failed_column_upgrade_restores_full_database(tmp_path: Path, monkeypatch):
    database = tmp_path / "rejected.db"
    _old_columns(database, invalid_section=True)
    with sqlite3.connect(database) as db:
        before = list(db.iterdump())
    result = _upgrade(database, monkeypatch)
    assert result.returncode != 0
    assert "NOT NULL constraint failed" in result.stderr
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
