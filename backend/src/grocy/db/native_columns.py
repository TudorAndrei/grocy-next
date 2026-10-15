"""Native SQLite defaults and nullability, independent of ORM insert defaults."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime, DefaultClause, MetaData, Numeric, text
from sqlalchemy.dialects.sqlite import DATETIME
from sqlalchemy.ext.compiler import compiles


def storage_affinity(declaration: str) -> str:
    declaration = declaration.upper()
    if "INT" in declaration:
        return "INTEGER"
    if any(name in declaration for name in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if not declaration or "BLOB" in declaration:
        return "BLOB"
    if any(name in declaration for name in ("REAL", "FLOA", "DOUB")):
        return "REAL"
    return "NUMERIC"


class NativeNumeric(Numeric):
    """Keep Decimal codecs while SQLite uses the native storage declaration."""

    def __init__(
        self,
        native_type: str = "NUMERIC",
        precision: int | None = None,
        scale: int | None = None,
        decimal_return_scale: int | None = None,
        asdecimal: bool = True,
    ) -> None:
        self.native_type = native_type
        super().__init__(precision, scale, decimal_return_scale, asdecimal)


@compiles(NativeNumeric, "sqlite")
def _native_numeric_sql(column_type: NativeNumeric, _compiler, **_kwargs) -> str:
    return column_type.native_type


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
            native_type = rule.get("type")
            if native_type is not None and isinstance(column.type, DateTime):
                column.type = column.type.with_variant(
                    DATETIME(truncate_microseconds=True), "sqlite"
                )
            if (
                native_type is not None
                and isinstance(column.type, Numeric)
                and storage_affinity(str(column.type)) != storage_affinity(native_type)
            ):
                previous = column.type
                column.type = NativeNumeric(
                    native_type,
                    previous.precision,
                    previous.scale,
                    previous.decimal_return_scale,
                    previous.asdecimal,
                )
