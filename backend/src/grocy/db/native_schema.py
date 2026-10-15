"""Pinned SQLite definitions, including their original trigger creation order."""

import json
from pathlib import Path

from sqlalchemy.engine import Connection

SCHEMA = json.loads(
    (Path(__file__).with_name("compatibility") / "grocy_4_5_0_schema.json").read_text()
)


def install_native_logic(connection: Connection) -> None:
    custom_triggers = [
        (name, statement)
        for name, statement in connection.exec_driver_sql(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY rowid"
        )
        if name not in SCHEMA["triggers"]
    ]
    for name in SCHEMA["views"]:
        connection.exec_driver_sql(f'DROP VIEW IF EXISTS "{name}"')
    for statement in SCHEMA["views"].values():
        connection.exec_driver_sql(statement)
    for name in SCHEMA["triggers"]:
        connection.exec_driver_sql(f'DROP TRIGGER IF EXISTS "{name}"')
    for statement in SCHEMA["triggers"].values():
        connection.exec_driver_sql(statement)
    remaining = set(
        connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").scalars()
    )
    for name, statement in custom_triggers:
        if name not in remaining:
            connection.exec_driver_sql(statement)
