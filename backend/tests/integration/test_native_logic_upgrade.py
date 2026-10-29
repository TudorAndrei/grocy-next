"""Keep a saved database intact when native object creation fails."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_stock_indexes_upgrade_keeps_saved_rows_counters_and_custom_indexes(tmp_path: Path):
    database = tmp_path / "stock-order.db"
    environment = {**os.environ, "GROCY_DATABASE_URL": f"sqlite+aiosqlite:///{database}"}
    command = [sys.executable, "-m", "alembic", "upgrade"]
    backend = Path(__file__).parents[2]
    created = subprocess.run(
        [*command, "20261016_0023"],
        cwd=backend,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert created.returncode == 0, created.stdout + created.stderr
    with sqlite3.connect(database) as db:
        db.executescript("""
            DROP INDEX IF EXISTS ix_stock_performance1;
            DROP INDEX IF EXISTS ix_stock_log_performance1;
            DROP INDEX IF EXISTS ix_stock_log_performance2;
            CREATE INDEX project_stock_note ON stock(note);
            INSERT INTO stock(id,product_id,amount,best_before_date,stock_id,open,note)
                VALUES (15,1,2.5,'2027-01-01','saved-order',0,'Saved');
            UPDATE sqlite_sequence SET seq=9000 WHERE name='stock';
            INSERT INTO stock_log(id,product_id,amount,stock_id,transaction_type,
                best_before_date,purchased_date,location_id,user_id,row_created_timestamp,note)
                VALUES (25,1,2.123456789,'saved-order','purchase',
                    '2027-01-01','2026-10-29',1,1,'2026-10-29 12:00:00','Saved booking');
            UPDATE sqlite_sequence SET seq=8000 WHERE name='stock_log';
        """)
        saved = db.execute("SELECT * FROM stock ORDER BY id").fetchall()
        bookings = db.execute("SELECT * FROM stock_log ORDER BY id").fetchall()
    upgraded = subprocess.run(
        [*command, "head"],
        cwd=backend,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM stock ORDER BY id").fetchall() == saved
        assert db.execute("SELECT * FROM stock_log ORDER BY id").fetchall() == bookings
        assert [row[2] for row in db.execute("PRAGMA index_info(ix_stock_performance1)")] == [
            "product_id",
            "open",
            "best_before_date",
            "amount",
        ]
        for name, columns in (
            ("ix_stock_log_performance1", ["stock_id", "transaction_type", "amount"]),
            (
                "ix_stock_log_performance2",
                [
                    "product_id",
                    "best_before_date",
                    "purchased_date",
                    "transaction_type",
                    "stock_id",
                    "undone",
                ],
            ),
        ):
            assert [row[2] for row in db.execute(f"PRAGMA index_info({name})")] == columns
        assert db.execute(
            "SELECT name FROM sqlite_master WHERE name='project_stock_note'"
        ).fetchone()
        inserted = db.execute(
            "INSERT INTO stock(product_id,amount,stock_id,open) VALUES (1,1,'next-order',0)"
        )
        assert inserted.lastrowid == 9001
        booking = db.execute(
            "INSERT INTO stock_log(product_id,amount,stock_id,transaction_type,user_id) "
            "VALUES (1,1,'next-order','purchase',1)"
        )
        assert booking.lastrowid == 8001


def test_native_logic_upgrade_rolls_back_name_conflicts(tmp_path: Path):
    database = tmp_path / "saved.db"
    environment = {**os.environ, "GROCY_DATABASE_URL": f"sqlite+aiosqlite:///{database}"}
    command = [sys.executable, "-m", "alembic", "upgrade"]
    backend = Path(__file__).parents[2]
    created = subprocess.run(
        [*command, "20261015_0020"],
        cwd=backend,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert created.returncode == 0, created.stdout + created.stderr
    with sqlite3.connect(database) as db:
        db.executescript("""
            INSERT INTO tasks(id,name) VALUES (20,'Saved');
            UPDATE sqlite_sequence SET seq=9000 WHERE name='tasks';
            CREATE TABLE project_audit(name TEXT);
            CREATE TRIGGER project_task AFTER INSERT ON tasks BEGIN
                INSERT INTO project_audit VALUES (NEW.name);
            END;
            CREATE VIEW sessions AS SELECT name FROM tasks;
        """)
        before = list(db.iterdump())
    rejected = subprocess.run(
        [*command, "head"],
        cwd=backend,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert rejected.returncode != 0
    assert "view sessions already exists" in rejected.stderr
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
        task = db.execute("INSERT INTO tasks(name) VALUES ('Next')")
        assert task.lastrowid == 9001
        assert db.execute("SELECT name FROM project_audit").fetchall() == [("Next",)]
        assert db.execute("SELECT name FROM sessions ORDER BY name").fetchall() == [
            ("Next",),
            ("Saved",),
        ]


def test_cli_initialization_supports_native_writes_without_startup_migrations(
    tmp_path: Path, monkeypatch
):
    import json

    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    database = tmp_path / "initialized.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "false")
    monkeypatch.setenv("GROCY_SEED_DEMO_DATA", "false")
    initialized = subprocess.run(
        [sys.executable, "-m", "grocy.cli", "init", "--username", "Owner"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert initialized.returncode == 0, initialized.stderr
    key = json.loads(initialized.stdout)["api_key"]
    with sqlite3.connect(database) as db:
        recipe = db.execute(
            "INSERT INTO recipes(name,base_servings) VALUES ('Direct SQL',3)"
        ).lastrowid
        assert db.execute(
            "SELECT base_servings,desired_servings FROM recipes WHERE id=?", (recipe,)
        ).fetchone() == (3, 3)
    clear_settings_cache()
    with TestClient(create_app(), headers={"GROCY-API-KEY": key}) as api:
        api.options("/api/system/info")

        def create(entity, **body):
            response = api.post(f"/api/objects/{entity}", json=body)
            assert response.status_code == 200, response.text
            return int(response.json()["created_object_id"])

        unit = create("quantity_units", name="Piece")
        purchase = create("quantity_units", name="Pack")
        location = create("locations", name="Kitchen")
        product = create(
            "products",
            name="Saved",
            location_id=location,
            qu_id_stock=unit,
            qu_id_purchase=purchase,
        )
        saved = api.get(f"/api/objects/products/{product}").json()
        assert saved["qu_id_consume"] == unit and saved["qu_id_price"] == purchase
        conversions = api.get("/api/objects/quantity_unit_conversions").json()
        assert {(row["from_qu_id"], row["to_qu_id"], row["factor"]) for row in conversions} == {
            (unit, purchase, 1),
            (purchase, unit, 1),
        }
