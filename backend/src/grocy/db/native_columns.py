"""Native SQLite defaults and nullability, independent of ORM insert defaults."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import DefaultClause, MetaData, text


@lru_cache
def native_column_rules() -> dict[str, dict[str, dict[str, Any]]]:
    path = Path(__file__).with_name("compatibility") / "grocy_4_5_0_columns.json"
    data = json.loads(path.read_text())
    return {
        name: {**columns, **data["extensions"].get(name, {})}
        for name, columns in data["columns"].items()
    }


def configure_native_columns(metadata: MetaData) -> None:
    for name, columns in native_column_rules().items():
        table = metadata.tables.get(name)
        if table is None:
            continue
        for name, rule in columns.items():
            if name not in table.columns:
                continue
            column = table.columns[name]
            column.nullable = rule["nullable"]
            default = rule["default"]
            column.server_default = DefaultClause(text(default)) if default is not None else None
