"""Copy supported Grocy tables into a new database and retain a source snapshot."""

import os
import sqlite3
import tempfile
from contextlib import closing
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import Date, DateTime, create_engine, event

from grocy.db.compatibility_views import install_compatibility_views
from grocy.db.imports.validate import validate_grocy_sqlite
from grocy.db.models import Base


def import_grocy_sqlite(source: str | Path, destination: str | Path) -> dict:
    source_path, target = Path(source).resolve(), Path(destination).resolve()
    validation = validate_grocy_sqlite(source_path)
    if not validation.ok:
        raise ValueError("; ".join(validation.errors))
    if source_path == target or target.exists():
        raise ValueError("Destination must be a new database file")
    target.parent.mkdir(parents=True, exist_ok=True)
    snapshot = target.with_suffix(target.suffix + ".source.sqlite")
    if snapshot.exists():
        raise ValueError("Source snapshot path already exists")
    fd, temporary = tempfile.mkstemp(prefix=".grocy-import-", dir=target.parent)
    os.close(fd)
    engine = None
    copied, ignored = {}, {}
    source_tables: set[str] = set()
    snapshot_created = False
    try:
        with (
            closing(sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)) as original,
            closing(sqlite3.connect(temporary)) as backup,
        ):
            # Backup includes committed WAL pages and supplies a consistent read snapshot.
            original.backup(backup)
        with closing(sqlite3.connect(temporary)) as saved:
            # Publish an exact source copy before creating the converted database.
            snapshot_fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(snapshot_fd)
            snapshot_created = True
            with closing(sqlite3.connect(snapshot)) as backup:
                saved.backup(backup)
        Path(temporary).unlink()
        engine = create_engine(f"sqlite:///{temporary}")

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine)
        with closing(sqlite3.connect(snapshot)) as source_db, engine.begin() as conn:
            install_compatibility_views(conn)
            source_db.row_factory = sqlite3.Row
            conn.exec_driver_sql("PRAGMA defer_foreign_keys=ON")
            source_tables = {
                r[0]
                for r in source_db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            for table in Base.metadata.sorted_tables:
                if table.name not in source_tables:
                    continue
                columns = {r[1] for r in source_db.execute(f'PRAGMA table_info("{table.name}")')}
                target_columns = set(table.columns.keys())
                ignored[table.name] = sorted(columns - target_columns)
                count = 0
                for row in source_db.execute(f'SELECT * FROM "{table.name}"'):
                    values = {}
                    for column in table.columns:
                        if column.name not in columns:
                            continue
                        value = row[column.name]
                        if (
                            value is None
                            and not column.nullable
                            and (column.default is not None or column.server_default is not None)
                        ):
                            continue
                        if isinstance(value, str) and value:
                            if isinstance(column.type, DateTime):
                                value = datetime.fromisoformat(value)
                            elif isinstance(column.type, Date):
                                value = date.fromisoformat(value[:10])
                        values[column.name] = value
                    if table.name == "userfield_values" and "field_id" in columns:
                        definition = source_db.execute(
                            "SELECT entity, name FROM userfields WHERE id = ?", (row["field_id"],)
                        ).fetchone()
                        if definition is None:
                            raise ValueError("Imported userfield has no definition")
                        values.update(entity=definition[0], name=definition[1])
                    if table.name == "recipes_pos" and not values.get("qu_id"):
                        unit = source_db.execute(
                            "SELECT qu_id_stock FROM products WHERE id = ?", (values["product_id"],)
                        ).fetchone()
                        if unit:
                            values["qu_id"] = unit[0]
                    if (
                        table.name == "api_keys"
                        and values.get("key_type") == "special-purpose-calendar-ical"
                    ):
                        values["key_type"] = "calendar"
                    conn.execute(table.insert().values(**values))
                    count += 1
                copied[table.name] = count
            if source_db.execute(
                "SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'"
            ).fetchone():
                for sequence in source_db.execute("SELECT name, seq FROM sqlite_sequence"):
                    table = Base.metadata.tables.get(sequence[0])
                    if table is None or not table.dialect_options["sqlite"]["autoincrement"]:
                        continue
                    # Keep allocation history, including counters above all remaining row IDs.
                    conn.exec_driver_sql(
                        "UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name=?",
                        (sequence[1], sequence[0]),
                    )
                    conn.exec_driver_sql(
                        "INSERT INTO sqlite_sequence (name, seq) SELECT ?, ? "
                        "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                        (sequence[0], sequence[1], sequence[0]),
                    )
            if "user_permissions" not in source_tables:
                conn.exec_driver_sql(
                    "INSERT INTO user_permissions (user_id, permission_id) SELECT id, 1 FROM users"
                )
            conn.exec_driver_sql(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            conn.exec_driver_sql("INSERT INTO alembic_version VALUES ('20261015_0009')")
            if conn.exec_driver_sql("PRAGMA foreign_key_check").fetchone():
                raise ValueError("Imported database has invalid references")
        engine.dispose()
        engine = None
        # Hard link publishes a complete file without replacing an existing destination.
        os.link(temporary, target)
        return {
            "database": str(target),
            "source_snapshot": str(snapshot),
            "copied_tables": copied,
            "archived_columns": {k: v for k, v in ignored.items() if v},
            "archived_tables": sorted(source_tables - set(copied)),
        }
    except Exception:
        if snapshot_created:
            snapshot.unlink(missing_ok=True)
        raise
    finally:
        if engine:
            engine.dispose()
        Path(temporary).unlink(missing_ok=True)
