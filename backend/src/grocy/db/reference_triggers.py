"""Install the pinned native validation and unit-default triggers."""

import json
from pathlib import Path

from sqlalchemy.engine import Connection

DEFINITIONS = Path(__file__).with_name("compatibility") / "grocy_4_5_0_reference_triggers.json"


def install_reference_triggers(connection: Connection) -> None:
    for name, statement in json.loads(DEFINITIONS.read_text())["triggers"].items():
        connection.exec_driver_sql(f'DROP TRIGGER IF EXISTS "{name}"')
        connection.exec_driver_sql(statement)
