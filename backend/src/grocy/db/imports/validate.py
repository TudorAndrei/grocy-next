from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_TABLES = (
    "products",
    "locations",
    "quantity_units",
    "stock",
    "users",
)


@dataclass
class ImportValidationResult:
    path: str
    ok: bool
    grocy_version: str | None = None
    tables: list[str] = field(default_factory=list)
    missing_tables: list[str] = field(default_factory=list)
    product_count: int = 0
    errors: list[str] = field(default_factory=list)


def validate_grocy_sqlite(path: str | Path) -> ImportValidationResult:
    db_path = Path(path)
    result = ImportValidationResult(path=str(db_path), ok=False)
    if not db_path.exists():
        result.errors.append("database file does not exist")
        return result
    if db_path.stat().st_size == 0:
        result.errors.append("database file is empty")
        return result
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        result.errors.append(f"cannot open database: {exc}")
        return result
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        result.tables = sorted(tables)
        result.missing_tables = [name for name in REQUIRED_TABLES if name not in tables]
        if result.missing_tables:
            result.errors.append(
                "missing required tables: " + ", ".join(result.missing_tables)
            )
        if "products" in tables:
            result.product_count = int(conn.execute("SELECT COUNT(*) FROM products").fetchone()[0])
        if "migrations" in tables:
            try:
                version = conn.execute(
                    "SELECT MAX(migration) FROM migrations"
                ).fetchone()
                if version and version[0] is not None:
                    result.grocy_version = str(version[0])
            except sqlite3.Error:
                pass
        result.ok = not result.errors
        return result
    finally:
        conn.close()
