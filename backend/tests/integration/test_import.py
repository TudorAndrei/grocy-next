import sqlite3
from pathlib import Path

import pytest

from grocy.db.imports.importer import import_grocy_sqlite
from grocy.db.imports.validate import validate_grocy_sqlite


def source_database(path: Path, *, bad_reference: bool = False):
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
            CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE quantity_units (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT,
                location_id INTEGER, qu_id_purchase INTEGER, qu_id_stock INTEGER, legacy_note TEXT);
            CREATE TABLE stock (id INTEGER PRIMARY KEY, product_id INTEGER, amount REAL,
                stock_id TEXT, location_id INTEGER, best_before_date TEXT);
            CREATE TABLE legacy_data (note TEXT);
            CREATE TABLE userfields (id INTEGER PRIMARY KEY, entity TEXT,
                name TEXT, caption TEXT, type TEXT);
            CREATE TABLE userfield_values (id INTEGER PRIMARY KEY, field_id INTEGER,
                object_id INTEGER, value TEXT);
            INSERT INTO userfields VALUES (1, 'products', 'origin', 'Origin', 'text');
            INSERT INTO userfield_values VALUES (1, 1, 1, 'Farm');
            INSERT INTO users VALUES (1, 'Owner');
            INSERT INTO locations VALUES (1, 'Kitchen');
            INSERT INTO quantity_units VALUES (1, 'Piece');
            INSERT INTO products VALUES (1, 'Milk', 1, 1, 1, 'keep this');
            INSERT INTO stock VALUES (1, 1, 3, 'imported-stock', 1, '2027-01-01');
            INSERT INTO legacy_data VALUES ('archive me');
            ALTER TABLE products ADD due_type INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE products ADD default_best_before_days_after_freezing INTEGER DEFAULT 0;
            ALTER TABLE products ADD quick_consume_amount REAL DEFAULT 1;
            ALTER TABLE quantity_units ADD active INTEGER NOT NULL DEFAULT 1;
            UPDATE products SET due_type=2, default_best_before_days_after_freezing=90,
                                quick_consume_amount=2.5;
            UPDATE quantity_units SET active=0;
        """)
        if bad_reference:
            conn.execute("UPDATE products SET location_id=999")


def test_import_preserves_data_source_and_existing_destination(tmp_path: Path):
    source, target = tmp_path / "source.db", tmp_path / "next.db"
    source_database(source)
    original = source.read_bytes()
    result = import_grocy_sqlite(source, target)
    assert result["copied_tables"]["products"] == 1
    assert result["archived_columns"]["products"] == ["legacy_note"]
    assert "legacy_data" in result["archived_tables"]
    assert source.read_bytes() == original
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT amount FROM stock").fetchone()[0] == 3
        assert conn.execute(
            "SELECT due_type, default_best_before_days_after_freezing, quick_consume_amount "
            "FROM products"
        ).fetchone() == (2, 90, 2.5)
        assert conn.execute("SELECT active FROM quantity_units").fetchone()[0] == 0
        assert conn.execute("SELECT permission_id FROM user_permissions").fetchone()[0] == 1
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT entity, name, value FROM userfield_values").fetchone() == (
            "products",
            "origin",
            "Farm",
        )
    with sqlite3.connect(result["source_snapshot"]) as snapshot:
        assert snapshot.execute("SELECT legacy_note FROM products").fetchone()[0] == "keep this"
    with pytest.raises(ValueError, match="new database"):
        import_grocy_sqlite(source, target)
    assert validate_grocy_sqlite(target).ok


def test_failed_import_rolls_back_and_bad_sqlite_is_reported(tmp_path: Path):
    source, target = tmp_path / "source.db", tmp_path / "next.db"
    source_database(source, bad_reference=True)
    with pytest.raises(ValueError, match="invalid references"):
        import_grocy_sqlite(source, target)
    assert not target.exists()
    assert not target.with_suffix(".db.source.sqlite").exists()
    bad = tmp_path / "bad.db"
    bad.write_text("not a database")
    result = validate_grocy_sqlite(bad)
    assert not result.ok
    assert any("invalid database" in error for error in result.errors)


def test_existing_project_database_upgrades_at_startup(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    database = tmp_path / "old-project.db"
    source_database(database)
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            CREATE TABLE chores (id INTEGER PRIMARY KEY, name TEXT, period_type TEXT,
                                 period_days INTEGER);
            CREATE TABLE chores_log (id INTEGER PRIMARY KEY, chore_id INTEGER, tracked_time TEXT,
                                    undone INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0);
            INSERT INTO chores VALUES (1, 'Legacy clean', 'daily', 3);
            INSERT INTO chores_log VALUES (1, 1, '2027-01-04 15:00:00', 0, 0);
            CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT, user_id INTEGER,
                                   key_type TEXT DEFAULT 'default');
            INSERT INTO api_keys VALUES (1, 'upgrade-key', 1, 'default');
            DROP TABLE userfield_values;
            CREATE TABLE userfield_values (id INTEGER PRIMARY KEY, entity TEXT,
                                          object_id INTEGER, name TEXT, value TEXT);
            INSERT INTO userfield_values VALUES (1, 'products', 1, 'origin', 'Farm');
        """)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_SEED_DEMO_DATA", "false")
    clear_settings_cache()
    with TestClient(create_app()) as upgraded:
        headers = {"GROCY-API-KEY": "upgrade-key"}
        stock = upgraded.get("/api/stock/products/1", headers=headers)
        assert stock.status_code == 200
        assert stock.json()["stock_amount"] == 3
        chore = upgraded.get("/api/chores/1", headers=headers)
        assert chore.status_code == 200
        assert chore.json()["chore"]["period_interval"] == 3
        assert chore.json()["tracked_count"] == 1
        assert chore.json()["next_estimated_execution_time"] == "2027-01-07T15:00:00"
        assert upgraded.get("/api/objects/equipment", headers=headers).status_code == 200
        assert upgraded.get("/api/users/1/permissions", headers=headers).json() == [
            {"permission_id": 1, "user_id": 1},
        ]
    with sqlite3.connect(database) as connection:
        assert (
            connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261015_0006"
        )
