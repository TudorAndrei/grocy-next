"""Keep the SQLite allocation history in native imports and project upgrades."""

import json
import re
import sqlite3
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from grocy.core.config import clear_settings_cache
from grocy.db.compatibility_views import install_compatibility_views
from grocy.db.imports.importer import import_grocy_sqlite
from grocy.db.session import reset_engine
from grocy.domains.catalog.objects import ENTITY_MODELS
from grocy.main import create_app

FIXTURES = Path(__file__).parents[1] / "fixtures"


def test_import_keeps_all_native_allocation_history(tmp_path: Path, monkeypatch):
    source, target = tmp_path / "native.db", tmp_path / "import.db"
    tables = json.loads((FIXTURES / "grocy-4.5.0-counter-tables.json").read_text())["tables"]
    expected = {name: 3000 + index * 10 for index, name in enumerate(tables)}
    with sqlite3.connect(source) as connection:
        for statement in tables.values():
            connection.execute(statement)
        connection.executescript("""
            INSERT INTO users (id, username, password) VALUES (1, 'Owner', '');
            INSERT INTO user_permissions (id, user_id, permission_id) VALUES (1, 1, 1);
            INSERT INTO api_keys (id, api_key, user_id, expires)
                VALUES (1, 'import-owner', 1, '2999-01-01 00:00:00');
            INSERT INTO quantity_units (id, name) VALUES (1, 'Piece');
            INSERT INTO locations (id, name) VALUES (1, 'Kitchen');
            INSERT INTO products (id, name, location_id, qu_id_purchase, qu_id_stock)
                VALUES (1, 'Milk', 1, 1, 1);
        """)
        for name, value in expected.items():
            connection.execute("DELETE FROM sqlite_sequence WHERE name=?", (name,))
            connection.execute("INSERT INTO sqlite_sequence (name,seq) VALUES (?,?)", (name, value))
    import_grocy_sqlite(source, target)
    with sqlite3.connect(target) as connection:
        actual = dict(connection.execute("SELECT name,seq FROM sqlite_sequence"))
        assert {name: actual.get(name) for name in expected} == expected
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{target}")
    clear_settings_cache()
    with TestClient(create_app(), headers={"GROCY-API-KEY": "import-owner"}) as app:
        location = app.post("/api/objects/locations", json={"name": "Next"})
        assert location.status_code == 200, location.text
        assert int(location.json()["created_object_id"]) == expected["locations"] + 1
        purchase = app.post("/api/stock/products/1/add", json={"amount": 1, "price": 2})
        assert purchase.status_code == 200, purchase.text
        assert purchase.json()[0]["id"] == expected["stock_log"] + 1
        assert app.get("/api/stock/products/1/entries").json()[0]["id"] == expected["stock"] + 1


def _data_snapshot(database: Path):
    with sqlite3.connect(database) as connection:
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
                "AND name != 'alembic_version' ORDER BY name"
            )
        ]
        values = {}
        for table in tables:
            columns = "*"
            if table == "userfield_values":
                columns = "id,entity,CAST(object_id AS TEXT),name,value,row_created_timestamp"
            values[table] = connection.execute(
                f'SELECT {columns} FROM "{table}" ORDER BY rowid'
            ).fetchall()
        return values


def test_upgrade_keeps_a_complete_saved_graph_and_new_id_allocation(tmp_path: Path, monkeypatch):
    database = tmp_path / "project.db"
    with sqlite3.connect(database) as connection:
        connection.executescript((FIXTURES / "project-0013-counters.sql").read_text())
        # Current API writes use native value identity. The legacy-name conversion
        # has its own saved revision 0017 test in test_userfield_identity.py.
        connection.execute("DROP TABLE userfield_values")
        native = json.loads((FIXTURES / "grocy-4.5.0-counter-tables.json").read_text())["tables"]
        connection.execute(native["userfield_values"])
        connection.execute("ALTER TABLE userfield_values ADD COLUMN entity TEXT")
        connection.execute("ALTER TABLE userfield_values ADD COLUMN name TEXT")
        connection.executescript("""
            CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);
            INSERT INTO alembic_version VALUES ('20261015_0013');
            INSERT INTO meal_plan_sections (id,name,sort_number) VALUES (-1,'',-1);
            ALTER TABLE tasks ADD COLUMN saved_location INTEGER REFERENCES locations(id) DEFAULT 1;
            CREATE TABLE saved_product_reference (product_id INTEGER REFERENCES products(id));
            CREATE TABLE counter_audit (kind TEXT, value INTEGER);
            CREATE VIEW saved_graph AS
                SELECT p.id,p.name,c.id AS price_id FROM products p
                LEFT JOIN cache__products_average_price c ON c.product_id=p.id;
            CREATE INDEX saved_product_description ON products(description);
            CREATE TRIGGER saved_task_trigger AFTER INSERT ON tasks BEGIN
                INSERT INTO counter_audit VALUES ('task', (SELECT COUNT(*) FROM products));
            END;
            CREATE TRIGGER saved_nutrition_trigger AFTER INSERT ON product_nutrition BEGIN
                INSERT INTO counter_audit VALUES ('nutrition', (SELECT COUNT(*) FROM products));
            END;
        """)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        install_compatibility_views(connection)
        connection.exec_driver_sql("""
            CREATE TRIGGER saved_price_view INSTEAD OF DELETE ON products_average_price BEGIN
                INSERT INTO counter_audit VALUES ('price-view', OLD.product_id);
            END
        """)
    engine.dispose()
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "false")
    clear_settings_cache()
    headers = {"GROCY-API-KEY": "dev-key"}
    with TestClient(create_app(), headers=headers) as old:

        def create_saved(table: str, **body):
            # Revision 0013 had ORM defaults, before native SQL defaults were installed.
            defaults = {
                column.name: float(column.default.arg)
                if isinstance(column.default.arg, Decimal)
                else column.default.arg
                for column in ENTITY_MODELS[table].__table__.columns
                if column.default is not None and not callable(column.default.arg)
            }
            response = old.post(f"/api/objects/{table}", json={**defaults, **body})
            assert response.status_code == 200, response.text
            return response

        location = create_saved("locations", name="Saved spare").json()["created_object_id"]
        purchase = old.post(
            "/api/stock/products/1/add", json={"amount": 2, "price": 3.25, "note": "Saved note"}
        )
        assert purchase.status_code == 200, purchase.text
        assert create_saved("tasks", name="Saved task", category_id=1).status_code == 200
        assert create_saved("shopping_list", product_id=1, amount=1, qu_id=1).status_code == 200
        field = create_saved(
            "userfields",
            entity="products",
            name="origin",
            caption="Origin",
            type="text-single-line",
        )
        assert field.status_code == 200, field.text
        assert old.put("/api/userfields/products/1", json={"origin": "Farm"}).status_code == 204
        assert old.put("/api/user/settings/kept", json={"value": "saved"}).status_code == 204
        entity = create_saved("userentities", name="saved", caption="Saved").json()[
            "created_object_id"
        ]
        assert create_saved("userobjects", userentity_id=entity).status_code == 200
        section = create_saved("meal_plan_sections", name="Saved meal").json()["created_object_id"]
        assert (
            create_saved(
                "meal_plan",
                **{
                    "day": "2027-01-04",
                    "type": "recipe",
                    "recipe_id": 1,
                    "recipe_servings": 2,
                    "section_id": section,
                },
            ).status_code
            == 200
        )
        assert create_saved("equipment", name="Saved equipment").status_code == 200
        product_meal = create_saved(
            "meal_plan",
            **{
                "day": "2027-01-04",
                "type": "product",
                "product_id": 2,
                "product_amount": 2.5,
                "product_qu_id": 2,
                "section_id": section,
            },
        )
        assert product_meal.status_code == 200, product_meal.text
        nutrition = old.put(
            "/api/v2/products/1/nutrition",
            json={
                "expected_revision": 0,
                "basis": {"quantity": 100, "unit": "g"},
                "nutrients": {"energy_kcal": 100},
            },
        )
        assert nutrition.status_code == 200, nutrition.text
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO saved_product_reference VALUES (1)")
        connection.execute(
            "INSERT INTO chores_log(chore_id,tracked_time,done_by_user_id,skipped,undone) "
            "VALUES (1,'2027-01-04',1,0,0)"
        )
        # Store the old record before upgrading. Native API permission views did not
        # exist in revision 0013, so the current charge handler cannot seed this schema.
        connection.execute(
            "INSERT INTO battery_charge_cycles "
            "(battery_id,tracked_time,undone,row_created_timestamp) VALUES (1,?,0,?)",
            ("2027-01-04 12:34:56", "2027-01-04 12:34:56"),
        )
        native = json.loads((FIXTURES / "grocy-4.5.0-counter-tables.json").read_text())["tables"]
        with sqlite3.connect(":memory:") as original:
            for ddl in native.values():
                original.execute(ddl)
            references = {}
            for table in native:
                columns = {row[1] for row in original.execute(f'PRAGMA table_info("{table}")')}
                references[table] = [
                    row[3]
                    for row in connection.execute(f'PRAGMA foreign_key_list("{table}")')
                    if row[3] in columns
                ]
        connection.execute("UPDATE sqlite_sequence SET seq=9000 WHERE name='tasks'")
        # This old table has no recorded counter until revision 0014 creates it.
        connection.execute(
            "INSERT INTO sqlite_sequence (name,seq) SELECT 'tasks',9000 "
            "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='tasks')"
        )
    before = _data_snapshot(database)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    after = _data_snapshot(database)
    assert {name for name in after if name not in before} == {
        "cache__quantity_unit_conversions_resolved",
        "migrations",
        "permission_hierarchy",
        "sessions",
    }
    for name, rows in before.items():
        if name in {"recipes", "recipes_nestings", "recipes_pos"}:
            assert all(row in after[name] for row in rows)
        else:
            assert after[name] == rows
    clear_settings_cache()
    reset_engine()
    monkeypatch.setenv("GROCY_AUTO_CREATE_SCHEMA", "true")
    with TestClient(create_app(), headers=headers) as upgraded:
        assert _data_snapshot(database) == after
        assert upgraded.get("/api/stock/products/1").json()["stock_amount"] == 2
        battery = upgraded.get("/api/batteries/1")
        assert battery.status_code == 200, battery.text
        assert battery.json()["last_charged"] == "2027-01-04 12:34:56"
        assert battery.json()["charge_cycles_count"] == 1
        assert upgraded.get("/api/userfields/products/1").json()["origin"] == "Farm"
        assert upgraded.delete(f"/api/objects/locations/{location}").status_code == 204
        next_location = upgraded.post("/api/objects/locations", json={"name": "Saved spare"})
        assert next_location.status_code == 200, next_location.text
        assert int(next_location.json()["created_object_id"]) > int(location)
        task = upgraded.post("/api/objects/tasks", json={"name": "After upgrade"})
        assert task.status_code == 200, task.text
        assert int(task.json()["created_object_id"]) == 9001
        nutrition = upgraded.put(
            "/api/v2/products/2/nutrition",
            json={
                "expected_revision": 0,
                "basis": {"quantity": 100, "unit": "g"},
                "nutrients": {"energy_kcal": 100},
            },
        )
        assert nutrition.status_code == 200, nutrition.text
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT COUNT(*) FROM counter_audit").fetchone()[0] == (
            len(before["counter_audit"]) + 2
        )
        assert connection.execute(
            "SELECT kind FROM counter_audit ORDER BY rowid DESC LIMIT 2"
        ).fetchall() == [("nutrition",), ("task",)]
        connection.execute("DELETE FROM products_average_price WHERE product_id=1")
        assert connection.execute(
            "SELECT kind,value FROM counter_audit ORDER BY rowid DESC LIMIT 1"
        ).fetchone() == ("price-view", 1)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name='saved_product_description'"
        ).fetchone() == ("saved_product_description",)
        assert connection.execute("SELECT COUNT(*) FROM saved_graph").fetchone()[0] > 0
        for table, columns in (
            ("equipment", "name"),
            ("shopping_lists", "name"),
            ("recipes_nestings", "recipe_id,includes_recipe_id,servings"),
        ):
            with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint failed"):
                connection.execute(
                    f'INSERT INTO "{table}" ({columns}) SELECT {columns} FROM "{table}" LIMIT 1'
                )
        for table, columns in references.items():
            for column in columns:
                assert connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] > 0
                connection.execute("SAVEPOINT orphan_reference")
                statement = (
                    f'UPDATE "{table}" SET "{column}"=2147483647 '
                    f'WHERE rowid=(SELECT MIN(rowid) FROM "{table}")'
                )
                if (table, column) == ("products", "qu_id_stock"):
                    with pytest.raises(
                        sqlite3.IntegrityError, match="qu_id_stock can only be changed"
                    ):
                        connection.execute(statement)
                    connection.execute("ROLLBACK TO orphan_reference")
                    connection.execute("RELEASE orphan_reference")
                    continue
                connection.execute(statement)
                assert connection.execute(
                    f'SELECT "{column}" FROM "{table}" ORDER BY rowid LIMIT 1'
                ).fetchone() == (2147483647,)
                connection.execute("ROLLBACK TO orphan_reference")
                connection.execute("RELEASE orphan_reference")
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
            connection.execute("UPDATE tasks SET saved_location=2147483647")
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
            connection.execute("UPDATE product_nutrition SET product_id=2147483647")
        native = json.loads((FIXTURES / "grocy-4.5.0-counter-tables.json").read_text())["tables"]
        for table, ddl in native.items():
            if not before.get(table):
                continue
            for expression in re.findall(r"CHECK\((\w+(?: IN \([^)]*\)| > 0))\)", ddl):
                column = expression.split()[0]
                invalid = 0 if expression.endswith("> 0") or "IN (1," in expression else 9
                with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
                    connection.execute(f'UPDATE "{table}" SET "{column}"=?', (invalid,))
        try:
            connection.execute("INSERT INTO equipment (name) VALUES ('')")
        except sqlite3.IntegrityError as error:
            assert "CHECK constraint failed" in str(error)
        else:
            raise AssertionError("The saved equipment check must still reject an empty name")


@pytest.mark.parametrize(
    "revision", ["20261015_0013", "20261015_0014", "20261015_0015", "20261015_0016"]
)
def test_failed_counter_upgrade_restores_the_original_schema_and_rows(
    tmp_path: Path, monkeypatch, revision: str
):
    database = tmp_path / "failed-upgrade.db"
    with sqlite3.connect(database) as connection:
        connection.executescript((FIXTURES / "project-0013-counters.sql").read_text())
        connection.executescript("""
            CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);
            INSERT INTO alembic_version VALUES ('20261015_0013');
            CREATE VIEW saved_equipment AS SELECT name FROM equipment;
            CREATE TABLE copied_names (name TEXT);
            CREATE TRIGGER saved_equipment_trigger AFTER INSERT ON equipment BEGIN
                INSERT INTO copied_names VALUES (NEW.name);
            END;
        """)
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    command = [sys.executable, "-m", "alembic", "upgrade"]
    if revision != "20261015_0013":
        result = subprocess.run(
            [*command, revision],
            cwd=Path(__file__).parents[2],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA ignore_check_constraints=ON")
        if revision == "20261015_0013":
            connection.execute("INSERT INTO equipment (id, name) VALUES (1, '')")
        elif revision == "20261015_0014":
            connection.execute("INSERT INTO tasks (name,done) VALUES ('Invalid task',2)")
            connection.execute("UPDATE sqlite_sequence SET seq=9000 WHERE name='tasks'")
        elif revision == "20261015_0015":
            connection.execute(
                "INSERT INTO meal_plan_sections (name,sort_number) VALUES ('Duplicate',0)"
            )
            connection.execute(
                "INSERT INTO meal_plan_sections (name,sort_number) VALUES ('Duplicate',0)"
            )
        else:
            connection.execute(
                "INSERT INTO recipes_nestings (recipe_id,includes_recipe_id,servings) "
                "VALUES (1,2,1)"
            )
            connection.execute(
                "INSERT INTO recipes_nestings (recipe_id,includes_recipe_id,servings) "
                "VALUES (1,2,1)"
            )
        connection.execute("PRAGMA ignore_check_constraints=OFF")
        schema = connection.execute(
            "SELECT type,name,sql FROM sqlite_master ORDER BY type,name"
        ).fetchall()
        counters = connection.execute(
            "SELECT name,seq FROM sqlite_sequence ORDER BY name"
        ).fetchall()
    before = _data_snapshot(database)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[2],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    constraint = "UNIQUE" if revision in {"20261015_0015", "20261015_0016"} else "CHECK"
    assert f"{constraint} constraint failed" in result.stderr
    assert _data_snapshot(database) == before
    with sqlite3.connect(database) as connection:
        assert (
            connection.execute(
                "SELECT type,name,sql FROM sqlite_master ORDER BY type,name"
            ).fetchall()
            == schema
        )
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            revision,
        )
        assert (
            connection.execute("SELECT name,seq FROM sqlite_sequence ORDER BY name").fetchall()
            == counters
        )
