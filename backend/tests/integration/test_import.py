import sqlite3
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

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
                object_id TEXT, value TEXT);
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
    with sqlite3.connect(source) as connection:
        connection.execute("INSERT INTO userfield_values VALUES (2,999,'001','Retained orphan')")
        connection.executescript("""
            CREATE TABLE chores (id INTEGER PRIMARY KEY, name TEXT, period_type TEXT);
            CREATE TABLE chores_log (id INTEGER PRIMARY KEY, chore_id INTEGER, tracked_time TEXT,
                                    undone INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0);
            INSERT INTO chores VALUES (1, 'Imported clean', 'daily');
            INSERT INTO chores_log VALUES (1, 1, '2027-01-04', 0, 0);
            INSERT INTO chores_log VALUES (2, 1, '2027-01-05 15:00:00', 0, 0);
        """)
    original = source.read_bytes()
    result = import_grocy_sqlite(source, target)
    assert result["copied_tables"]["products"] == 1
    assert result["archived_columns"]["products"] == ["legacy_note"]
    assert "legacy_data" in result["archived_tables"]
    assert source.read_bytes() == original
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT amount FROM stock").fetchone()[0] == 3
        assert conn.execute("SELECT tracked_time FROM chores_log ORDER BY id").fetchall() == [
            ("2027-01-04",),
            ("2027-01-05 15:00:00",),
        ]
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
        assert conn.execute(
            "SELECT field_id,object_id,value FROM userfield_values WHERE id=2"
        ).fetchone() == (999, "001", "Retained orphan")
    with sqlite3.connect(result["source_snapshot"]) as snapshot:
        assert snapshot.execute("SELECT legacy_note FROM products").fetchone()[0] == "keep this"
    with pytest.raises(ValueError, match="new database"):
        import_grocy_sqlite(source, target)
    assert validate_grocy_sqlite(target).ok


def test_failed_import_rolls_back_and_bad_sqlite_is_reported(tmp_path: Path):
    source, target = tmp_path / "source.db", tmp_path / "next.db"
    source_database(source)
    with sqlite3.connect(source) as connection:
        connection.execute("UPDATE products SET due_type=0")
    with pytest.raises(IntegrityError, match="CHECK constraint failed"):
        import_grocy_sqlite(source, target)
    assert not target.exists()
    assert not target.with_suffix(".db.source.sqlite").exists()
    bad = tmp_path / "bad.db"
    bad.write_text("not a database")
    result = validate_grocy_sqlite(bad)
    assert not result.ok
    assert any("invalid database" in error for error in result.errors)


def test_import_preserves_dangling_native_references(tmp_path: Path):
    source, target = tmp_path / "source.db", tmp_path / "next.db"
    source_database(source, bad_reference=True)
    with sqlite3.connect(source) as connection:
        connection.execute("UPDATE stock SET product_id=2147483647,location_id=999")
    original = source.read_bytes()
    result = import_grocy_sqlite(source, target)
    assert result["copied_tables"]["stock"] == 1
    assert source.read_bytes() == original
    with sqlite3.connect(target) as connection:
        assert connection.execute("SELECT location_id FROM products").fetchone() == (999,)
        assert connection.execute("SELECT product_id,location_id FROM stock").fetchone() == (
            2147483647,
            999,
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_disabled_location_tracking_restores_default_for_existing_user(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    database = tmp_path / "locations.db"
    source = tmp_path / "source.db"
    source_database(source)
    import_grocy_sqlite(source, database)
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            UPDATE locations SET id=2;
            UPDATE products SET location_id=2;
            UPDATE stock SET location_id=2;
            INSERT INTO api_keys (api_key, user_id, key_type)
                VALUES ('locations-key', 1, 'default');
        """)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_FEATURE_FLAG_STOCK_LOCATION_TRACKING", "0")
    clear_settings_cache()
    with TestClient(create_app()) as app:
        headers = {"GROCY-API-KEY": "locations-key"}
        response = app.get("/api/objects/locations", headers=headers)
        assert response.status_code == 200, response.text
        assert [(row["id"], row["name"]) for row in response.json()] == [
            (1, "Default"),
            (2, "Kitchen"),
        ]
        assert app.get("/api/objects/products/1", headers=headers).json()["location_id"] == 2


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
            INSERT INTO chores VALUES (2, 'Legacy date clean', 'daily', 3);
            INSERT INTO chores_log VALUES (1, 1, '2027-01-04 15:00:00', 0, 0);
            INSERT INTO chores_log VALUES (2, 2, '2027-01-04', 0, 0);
            CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT, user_id INTEGER,
                                   key_type TEXT DEFAULT 'default');
            INSERT INTO api_keys VALUES (1, 'upgrade-key', 1, 'default');
            CREATE TABLE user_settings (id INTEGER PRIMARY KEY, user_id INTEGER,
                                        key TEXT, value TEXT NOT NULL,
                                        row_created_timestamp DATETIME);
            INSERT INTO user_settings VALUES (1, 1, 'legacy-setting', 'kept',
                                               '2026-01-01 12:00:00');
            DROP TABLE userfield_values;
            CREATE TABLE userfield_values (id INTEGER PRIMARY KEY, entity TEXT,
                                          object_id INTEGER, name TEXT, value TEXT NOT NULL);
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
        assert chore.json()["next_estimated_execution_time"] == "2027-01-07 15:00:00"
        date_chore = upgraded.get("/api/chores/2", headers=headers)
        assert date_chore.status_code == 200
        assert date_chore.json()["last_tracked"] == "2027-01-04"
        assert date_chore.json()["next_estimated_execution_time"] == "2027-01-07 00:00:00"
        assert upgraded.get("/api/objects/equipment", headers=headers).status_code == 200
        assert upgraded.get("/api/userfields/products/1", headers=headers).json() == {
            "origin": "Farm"
        }
        assert (
            upgraded.put(
                "/api/userfields/products/1", headers=headers, json={"origin": None}
            ).status_code
            == 204
        )
        assert upgraded.get("/api/userfields/products/1", headers=headers).json() == {
            "origin": None
        }
        assert upgraded.get("/api/user/settings/legacy-setting", headers=headers).json() == {
            "value": "kept"
        }
        assert (
            upgraded.put(
                "/api/user/settings/legacy-setting", headers=headers, json={"value": None}
            ).status_code
            == 204
        )
        assert upgraded.get("/api/user/settings/legacy-setting", headers=headers).json() == {
            "value": None
        }
        assert upgraded.get("/api/users/1/permissions", headers=headers).json() == [
            {"id": 1, "permission_id": 1, "user_id": 1},
        ]
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT value, row_created_timestamp, row_updated_timestamp IS NOT NULL "
            "FROM user_settings WHERE key = 'legacy-setting'"
        ).fetchone() == ("", "2026-01-01 12:00:00", 1)
        assert (
            connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "20261015_0020"
        )


def test_database_change_time_tracks_wal_writes(tmp_path: Path, monkeypatch, api_headers: dict):
    import os
    import time
    from datetime import datetime

    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'wal.db'}")
    monkeypatch.setenv("GROCY_DATABASE_WAL", "true")
    clear_settings_cache()
    with TestClient(create_app(), headers=api_headers) as app:
        database = tmp_path / "wal.db"
        wal = tmp_path / "wal.db-wal"
        assert wal.exists()
        # The Grocy timestamp has whole seconds. Age both files before the real write.
        previous = time.time() - 5
        for path in (database, wal):
            os.utime(path, (previous, previous))
        before = app.get("/api/system/db-changed-time").json()["changed_time"]
        created = app.post("/api/objects/locations", json={"name": "WAL location"})
        assert created.status_code == 200
        after = app.get("/api/system/db-changed-time").json()["changed_time"]
        assert datetime.fromisoformat(after) > datetime.fromisoformat(before)
        saved = app.get(f"/api/objects/locations/{created.json()['created_object_id']}").json()
        assert saved["name"] == "WAL location"


def test_upgrade_restores_derived_meals_and_inverse_conversions(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    database = tmp_path / "previous-schema.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    clear_settings_cache()
    headers = {"GROCY-API-KEY": "dev-key"}
    with TestClient(create_app()) as app:
        assert (
            app.post(
                "/api/objects/meal_plan",
                headers=headers,
                json={"day": "2036-04-01", "type": "recipe", "recipe_id": 1, "recipe_servings": 2},
            ).status_code
            == 200
        )
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            DELETE FROM recipes_nestings WHERE recipe_id IN
                (SELECT id FROM recipes WHERE type LIKE 'mealplan-%');
            DELETE FROM recipes_pos WHERE recipe_id IN
                (SELECT id FROM recipes WHERE type LIKE 'mealplan-%');
            DELETE FROM recipes WHERE type LIKE 'mealplan-%';
            DELETE FROM quantity_unit_conversions WHERE from_qu_id = 2 AND to_qu_id = 3;
            UPDATE alembic_version SET version_num = '20261015_0009';
        """)
    clear_settings_cache()
    with TestClient(create_app()) as app:
        recipes = app.get(
            "/api/objects/recipes",
            headers=headers,
            params={"query[]": "type=mealplan-day"},
        ).json()
        assert len(recipes) == 1
        status = app.get(f"/api/recipes/{recipes[0]['id']}/fulfillment", headers=headers).json()
        assert status["costs"] == 0
        assert status["missing_products_count"] == 3
        conversions = app.get(
            "/api/objects/quantity_unit_conversions",
            headers=headers,
            params=[("query[]", "from_qu_id=2"), ("query[]", "to_qu_id=3")],
        ).json()
        assert len(conversions) == 1
        assert conversions[0]["factor"] == pytest.approx(0.001)


def test_import_keeps_deleted_user_references_and_id_sequence(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from grocy.core.config import clear_settings_cache
    from grocy.main import create_app

    source, target = tmp_path / "deleted-user-source.db", tmp_path / "deleted-user-target.db"
    source_database(source)
    with sqlite3.connect(source) as connection:
        connection.executescript("""
            ALTER TABLE users RENAME TO legacy_users;
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
            INSERT INTO users SELECT * FROM legacy_users;
            DROP TABLE legacy_users;
            INSERT INTO users VALUES (100, 'Deleted');
            INSERT INTO users VALUES (250, 'Also deleted');
            DELETE FROM users WHERE id IN (100, 250);
            CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT, user_id INTEGER,
                                   key_type TEXT DEFAULT 'default', expires DATETIME);
            INSERT INTO api_keys VALUES (1, 'import-owner', 1, 'default', '2999-01-01 00:00:00');
            INSERT INTO api_keys VALUES (2, 'deleted-key', 100, 'default', '2999-01-01 00:00:00');
            CREATE TABLE user_settings (id INTEGER PRIMARY KEY, user_id INTEGER,
                                        key TEXT, value TEXT);
            INSERT INTO user_settings VALUES (1, 100, 'kept', 'saved');
            CREATE TABLE user_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
                                           permission_id INTEGER);
            INSERT INTO user_permissions VALUES (1, 1, 1);
            INSERT INTO user_permissions VALUES (2, 100, 1);
            INSERT INTO user_permissions VALUES (700, 100, 5);
            DELETE FROM user_permissions WHERE id=700;
            CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT, assigned_to_user_id INTEGER);
            INSERT INTO tasks VALUES (1, 'Future assignee', 1000);
        """)
    import_grocy_sqlite(source, target)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{target}")
    clear_settings_cache()
    with TestClient(create_app(), headers={"GROCY-API-KEY": "import-owner"}) as app:
        assert app.get("/api/user", headers={"GROCY-API-KEY": "deleted-key"}).status_code == 401
        created = app.post("/api/users", json={"username": "Next", "password": "test"})
        assert created.status_code == 204, created.text
        assert app.get("/api/users", params={"query[]": "username=Next"}).json()[0]["id"] == 251
        assert app.get("/api/users/251/permissions").json()[0]["id"] == 701
        assert app.get("/api/user", headers={"GROCY-API-KEY": "deleted-key"}).status_code == 401
        assert app.get("/api/users/100/permissions").json() == [
            {"id": 2, "user_id": 100, "permission_id": 1}
        ]
    with sqlite3.connect(target) as connection:
        assert connection.execute(
            "SELECT user_id FROM api_keys WHERE api_key='deleted-key'"
        ).fetchone() == (100,)
        assert connection.execute(
            "SELECT value FROM user_settings WHERE user_id=100"
        ).fetchone() == ("saved",)
