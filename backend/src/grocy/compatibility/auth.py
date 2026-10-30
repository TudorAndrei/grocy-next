"""Legacy API credential selection, binding, and use records in Python."""

import os
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import empty, pdo_parameter, php_error
from grocy.core.time import server_timezone


def _parameter(value: Any) -> bytes | None:
    if isinstance(value, bytes):
        return value
    value = pdo_parameter(value)
    return None if value is None else value.encode("utf-8", "surrogateescape")


def _bindings(key: Any, now: str, key_type: str | None) -> tuple[bytes | None, ...]:
    defaults = [_parameter(key), now.encode()]
    if key_type is not None:
        defaults.append(key_type.encode())
    if not isinstance(key, (dict, list)):
        return tuple(defaults)
    values: list[bytes | None] = [None] * len(defaults)
    items = key.items() if isinstance(key, dict) else enumerate(key)
    next_index = 0
    for name, value in items:
        if isinstance(name, int):
            index = next_index
            next_index += 1
        elif name.lstrip(":") in {"1", "2", "3"}:
            index = int(name.lstrip(":")) - 1
        else:
            index = -1
        if not 0 <= index < len(defaults):
            raise php_error("SQLSTATE[HY000]: General error: 25 column index out of range")
        values[index] = _parameter(value)
    return tuple(values)


async def select_key(
    session: AsyncSession, key: Any, key_type: str = "default"
) -> tuple[bool, int | None]:
    return await _select_credential(session, key, "api_keys", "api_key", key_type)


async def select_session(session: AsyncSession, key: Any) -> tuple[bool, int | None]:
    return await _select_credential(session, key, "sessions", "session_key", None)


async def _select_credential(
    session: AsyncSession, key: Any, table: str, column: str, key_type: str | None
) -> tuple[bool, int | None]:
    if empty(key) or (isinstance(key, bytes) and key in {b"", b"0"}):
        return False, None
    now = datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S")
    connection = await session.connection()
    identity = (
        await connection.exec_driver_sql(
            f"SELECT id FROM {table} WHERE {column}=CAST(? AS TEXT) "
            "AND expires>CAST(? AS TEXT) "
            + ("AND key_type=CAST(? AS TEXT) " if key_type is not None else "")
            + "LIMIT 1",
            _bindings(key, now, key_type),
        )
    ).scalar_one_or_none()
    if identity is None:
        return False, None
    database = session.get_bind().engine.url.database
    path = Path(database) if database and database != ":memory:" else None
    previous = path.stat() if path and path.is_file() else None
    await connection.exec_driver_sql(f"UPDATE {table} SET last_used=? WHERE id=?", (now, identity))
    await session.commit()
    if previous is not None and path is not None:
        os.utime(path, (previous.st_atime, previous.st_mtime))

    # LessQL quotes the selected value again for its user lookup. This has
    # different NUL and array rules from the bound credential validation above.
    values = (
        list(key.values()) if isinstance(key, dict) else key if isinstance(key, list) else [key]
    )
    if any(isinstance(value, (dict, list)) for value in values):
        raise php_error("PDO::quote(): Argument #1 ($string) must be of type string, array given")
    parameters = tuple(
        None if (parameter := _parameter(value)) is None else parameter.split(b"\0", 1)[0]
        for value in values
    )
    placeholders = ",".join("CAST(? AS TEXT)" for _ in parameters)
    connection = await session.connection()
    user = (
        await connection.exec_driver_sql(
            f"SELECT users.id FROM {table} LEFT JOIN users ON users.id={table}.user_id "
            f"WHERE {column} IN ({placeholders}) LIMIT 1",
            parameters,
        )
    ).scalar_one_or_none()
    return True, user
