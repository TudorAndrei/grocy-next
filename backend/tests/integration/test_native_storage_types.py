"""Check the SQLite arithmetic used by native catalog statements."""

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache
from grocy.main import create_app


@pytest.mark.parametrize(
    "table,body,column",
    [
        ("quantity_unit_conversions", {"from_qu_id": 1, "to_qu_id": 3, "factor": 2}, "factor"),
        (
            "products",
            {
                "name": "Real",
                "location_id": 1,
                "qu_id_stock": 1,
                "qu_id_purchase": 1,
                "quick_consume_amount": 2,
            },
            "quick_consume_amount",
        ),
        (
            "chores",
            {"name": "Real", "period_type": "manually", "product_amount": 2},
            "product_amount",
        ),
        ("product_barcodes", {"product_id": 1, "barcode": "storage-real", "amount": 2}, "amount"),
        ("recipes_pos", {"recipe_id": 1, "product_id": 1, "qu_id": 1, "amount": 2}, "amount"),
        (
            "meal_plan",
            {"day": "2027-01-01", "type": "note", "note": "Real", "product_amount": 2},
            "product_amount",
        ),
    ],
)
def test_native_real_storage_keeps_fractional_sql_results(
    tmp_path, monkeypatch, table, body, column
):
    database = tmp_path / "real.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    clear_settings_cache()
    with TestClient(create_app()), sqlite3.connect(database) as db:
        columns = ",".join(f'"{name}"' for name in body)
        values = ",".join("?" for _name in body)
        row = db.execute(
            f'INSERT INTO "{table}" ({columns}) VALUES ({values})', tuple(body.values())
        )
        assert db.execute(
            f'SELECT typeof("{column}"),1/"{column}" FROM "{table}" WHERE id=?', (row.lastrowid,)
        ).fetchone() == ("real", 0.5)


def _saved(database: Path, *, precise: bool = False, integer_check: bool = False):
    extra = "CHECK(typeof(factor)='integer')" if integer_check else ""
    with sqlite3.connect(database) as db:
        db.executescript(f"""
            CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);
            INSERT INTO alembic_version VALUES ('20261015_0019');
            CREATE TABLE quantity_unit_conversions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_qu_id INTEGER NOT NULL, to_qu_id INTEGER NOT NULL,
                factor NUMERIC(18,8) NOT NULL {extra}, product_id INTEGER,
                row_created_timestamp DATETIME
            );
            CREATE INDEX conversion_note ON quantity_unit_conversions(from_qu_id);
            CREATE VIEW saved_factor AS SELECT factor FROM quantity_unit_conversions;
            CREATE TABLE conversion_audit (factor NUMERIC);
            CREATE TABLE chores_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, tracked_time TEXT
            );
            INSERT INTO chores_log VALUES (5,'2027-01-04'),(6,'2027-01-04 15:16:17'),(7,NULL);
            CREATE TABLE recipes_nestings (
                id INTEGER PRIMARY KEY AUTOINCREMENT, servings NUMERIC(15,6)
            );
            INSERT INTO recipes_nestings VALUES (10,2.5),(11,NULL);
            CREATE TABLE stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT, purchased_date TEXT, opened_date TEXT,
                product_id INTEGER, amount REAL, best_before_date TEXT, open INTEGER
            );
            INSERT INTO stock(id,purchased_date,opened_date)
                VALUES (15,'2027-01-04','2027-01-04 15:16:17'),(16,NULL,'');
            CREATE TRIGGER conversion_update AFTER UPDATE ON quantity_unit_conversions BEGIN
                INSERT INTO conversion_audit VALUES (NEW.factor);
            END;
        """)
        db.execute(
            "INSERT INTO quantity_unit_conversions VALUES (20,1,2,?,NULL,'2026-01-02 03:04:05')",
            (9007199254740993 if precise else 2,),
        )
        db.execute("UPDATE sqlite_sequence SET seq=9000 WHERE name='quantity_unit_conversions'")


def _upgrade(database, monkeypatch):
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_storage_upgrade_keeps_values_counters_and_custom_sql(tmp_path, monkeypatch):
    database = tmp_path / "saved.db"
    _saved(database)
    result = _upgrade(database, monkeypatch)
    assert result.returncode == 0, result.stdout + result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM chores_log ORDER BY id").fetchall() == [
            (5, "2027-01-04"),
            (6, "2027-01-04 15:16:17"),
            (7, None),
        ]
        assert db.execute("SELECT * FROM recipes_nestings ORDER BY id").fetchall() == [
            (10, 2.5),
            (11, None),
        ]
        assert db.execute(
            "SELECT id,purchased_date,opened_date FROM stock ORDER BY id"
        ).fetchall() == [
            (15, "2027-01-04", "2027-01-04 15:16:17"),
            (16, None, ""),
        ]
        assert db.execute(
            "SELECT id,from_qu_id,to_qu_id,factor,product_id,row_created_timestamp "
            "FROM quantity_unit_conversions"
        ).fetchall() == [(20, 1, 2, 2, None, "2026-01-02 03:04:05")]
        assert db.execute("SELECT 1/factor FROM saved_factor").fetchone() == (0.5,)
        assert db.execute("SELECT name FROM sqlite_master WHERE name='conversion_note'").fetchone()
        db.execute("UPDATE quantity_unit_conversions SET factor=4 WHERE id=20")
        assert db.execute("SELECT factor FROM conversion_audit").fetchall() == [(4,)]
        row = db.execute(
            "INSERT INTO quantity_unit_conversions(from_qu_id,to_qu_id,factor) VALUES (2,3,2)"
        )
        assert row.lastrowid == 9001


@pytest.mark.parametrize("mode", ["precise", "integer_check"])
def test_rejected_storage_upgrade_restores_database(tmp_path, monkeypatch, mode):
    database = tmp_path / "rejected.db"
    _saved(database, **{mode: True})
    with sqlite3.connect(database) as db:
        before = list(db.iterdump())
    result = _upgrade(database, monkeypatch)
    assert result.returncode != 0
    expected = "would change a saved value" if mode == "precise" else "CHECK constraint failed"
    assert expected in result.stderr
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
