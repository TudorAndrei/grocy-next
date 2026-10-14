import sqlite3
from pathlib import Path

from grocy.db.imports.validate import validate_grocy_sqlite


def test_validate_missing_file(tmp_path: Path) -> None:
    result = validate_grocy_sqlite(tmp_path / "missing.db")
    assert result.ok is False
    assert "does not exist" in result.errors[0]


def test_validate_minimal_grocy_db(tmp_path: Path) -> None:
    path = tmp_path / "grocy.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE quantity_units (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE stock (id INTEGER PRIMARY KEY, product_id INTEGER, amount REAL);
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        INSERT INTO products (name) VALUES ('Milk');
        """
    )
    conn.close()
    result = validate_grocy_sqlite(path)
    assert result.ok is True
    assert result.product_count == 1
    assert result.missing_tables == []
