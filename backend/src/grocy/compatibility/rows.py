"""Save LessQL row trees with the release's statement and reference order."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import pdo_parameter
from grocy.core.errors import GrocyError
from grocy.db.native_schema import SCHEMA


def _identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _parameter(value: Any) -> str | None:
    if isinstance(value, bool):
        value = int(value)
    parameter = pdo_parameter(value)
    return parameter.split("\x00", 1)[0] if parameter is not None else None


@dataclass
class _Row:
    table: str
    data: dict[str, Any]
    original_id: int | str | None = None
    references: dict[str, _Row] = field(default_factory=dict)
    children: list[_Row] = field(default_factory=list)
    dirty: bool = True

    @classmethod
    def build(cls, table: str, values: dict[str, Any], identity: int | str | None = None) -> _Row:
        row = cls(table, {}, identity)
        if identity is not None:
            row.data["id"] = identity
        for name, value in values.items():
            if isinstance(value, (dict, list)):
                if name.endswith("List"):
                    records = value.values() if isinstance(value, dict) else value
                    row.children.extend(cls.build(name[:-4], record) for record in records)
                else:
                    nested_values = value if isinstance(value, dict) else dict(enumerate(value))
                    row.references[name + "_id"] = cls.build(
                        name, {str(key): item for key, item in nested_values.items()}
                    )
            else:
                row.data[name] = value
        return row

    def tree(self) -> list[_Row]:
        return [
            self,
            *(node for row in (*self.references.values(), *self.children) for node in row.tree()),
        ]


async def save_rows(
    session: AsyncSession,
    table: str,
    values: dict[str, Any],
    identity: int | str | None = None,
) -> str:
    root = _Row.build(table, values, identity)
    rows = root.tree()
    last_insert_id = "0"
    while any(row.dirty for row in rows):
        for row in rows:
            for name, reference in row.references.items():
                value = reference.data.get("id")
                if name not in row.data or row.data[name] != value:
                    row.data[name] = value
                    row.dirty = True
            if not row.dirty:
                continue
            columns = SCHEMA["tables"].get(row.table)
            if columns is None:
                raise GrocyError(
                    f"SQLSTATE[HY000]: General error: 1 no such table: {row.table}", code=None
                )
            for name in row.data:
                if name not in columns:
                    message = (
                        f"no such column: {name}"
                        if row.original_id is not None
                        else f"table {row.table} has no column named {name}"
                    )
                    raise GrocyError("SQLSTATE[HY000]: General error: 1 " + message, code=None)
            connection = await session.connection()
            if row.data:
                if row.original_id is None:
                    names = ",".join(_identifier(name) for name in row.data)
                    placeholders = ",".join("?" for _ in row.data)
                    result = await connection.exec_driver_sql(
                        f"INSERT INTO {_identifier(row.table)} ({names}) VALUES ({placeholders})",
                        tuple(_parameter(value) for value in row.data.values()),
                    )
                    last_insert_id = str(result.lastrowid)
                    row.data.setdefault("id", result.lastrowid)
                else:
                    assignments = ",".join(f"{_identifier(name)}=?" for name in row.data)
                    await connection.exec_driver_sql(
                        f"UPDATE {_identifier(row.table)} SET {assignments} WHERE id=?",
                        (*[_parameter(value) for value in row.data.values()], str(row.original_id)),
                    )
                await session.commit()
                session.expire_all()
            row.original_id = row.data.get("id")
            row.dirty = False
            for child in row.children:
                name = row.table + "_id"
                if child.data.get(name) != row.data.get("id"):
                    child.data[name] = row.data.get("id")
                    child.dirty = True
    return last_insert_id
