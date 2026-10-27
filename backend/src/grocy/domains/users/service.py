import re
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import bcrypt
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility import client_defaults
from grocy.compatibility.input import database_error
from grocy.compatibility.php import php_error, php_string
from grocy.compatibility.query import query_rows
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.core.permissions import PERMISSIONS
from grocy.core.time import server_timezone
from grocy.db.native_schema import SCHEMA


def _text(payload: dict[str, Any], name: str) -> str | None:
    value = payload.get(name)
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "1" if value else ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() and abs(value) < 1e15 else repr(value)
    raise GrocyError(f"Invalid value for field {name}", code=None)


def _required(values: dict[str, str | None], *names: str) -> None:
    for name in names:
        if values[name] is None:
            raise GrocyError(f"Invalid value for field {name}", code=None)


def _permission(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        raise php_error("PDO::quote(): Argument #1 ($string) must be of type string, array given")
    if value is None:
        return None
    return php_string(int(value) if isinstance(value, bool) else value).split("\x00", 1)[0]


class UsersService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @asynccontextmanager
    async def _write(self) -> AsyncGenerator[None]:
        try:
            yield
            await self.session.commit()
            self.session.expire_all()
        except DBAPIError as error:
            await self.session.rollback()
            raise database_error(error) from error

    async def current_user(self, user_id: int) -> list[dict[str, Any]]:
        result = await self.session.execute(
            text("SELECT * FROM users_dto WHERE id=:user_id"), {"user_id": user_id}
        )
        return [dict(row) for row in result.mappings()]

    async def list_users(self, query_string: bytes = b"") -> list[dict[str, Any]]:
        return await query_rows(self.session, "users_dto", query_string, caught=True)

    async def _password(self, value: str | None) -> str:
        if value is None or "\x00" in value:
            raise GrocyError("Invalid value for field password", code=None)
        hashed = await run_in_threadpool(bcrypt.hashpw, value.encode()[:72], bcrypt.gensalt())
        return hashed.decode().replace("$2b$", "$2y$", 1)

    def _profile(self, payload: dict[str, Any]) -> dict[str, str | None]:
        names = ("username", "first_name", "last_name", "picture_file_name", "password")
        return {name: _text(payload, name) for name in names}

    async def create_user(self, payload: dict[str, Any]) -> None:
        values = self._profile(payload)
        _required(values, "username")
        values["password"] = await self._password(values["password"])
        async with self._write():
            connection = await self.session.connection()
            result = await connection.execute(
                text(
                    "INSERT INTO users(username,first_name,last_name,password,picture_file_name) "
                    "VALUES (:username,:first_name,:last_name,:password,:picture_file_name)"
                ),
                values,
            )
            user_id = result.lastrowid
            for permission_id, (name, _) in PERMISSIONS.items():
                if name in get_settings().default_permissions:
                    await self.session.execute(
                        text(
                            "INSERT INTO user_permissions(user_id,permission_id) "
                            "VALUES (:user_id,:permission_id)"
                        ),
                        {"user_id": user_id, "permission_id": permission_id},
                    )

    async def update_user(self, user_id: str, payload: dict[str, Any]) -> None:
        values = self._profile(payload)
        _required(values, "username", "first_name", "last_name")
        password = values.pop("password")
        if password not in (None, "", "0"):
            values["password"] = await self._password(password)
        exists = await self.session.scalar(
            text("SELECT 1 FROM users WHERE id=:user_id"), {"user_id": user_id}
        )
        if not exists:
            raise GrocyError("User does not exist", code=None)
        assignments = ",".join(f'"{key}"=:{key}' for key in values)
        async with self._write():
            await self.session.execute(
                text(f"UPDATE users SET {assignments} WHERE id=:user_id"),
                {**values, "user_id": user_id},
            )

    async def delete_user(self, user_id: str) -> None:
        async with self._write():
            connection = await self.session.connection()
            result = await connection.execute(
                text("DELETE FROM users WHERE id=:user_id"), {"user_id": user_id}
            )
            if not result.rowcount:
                raise php_error("Call to a member function delete() on null")

    async def settings(self, user_id: int) -> dict[str, Any]:
        result = await self.session.execute(
            text('SELECT "key",value FROM user_settings WHERE user_id=:user_id'),
            {"user_id": user_id},
        )
        settings = dict(client_defaults()["user_settings"])
        next_index = 0
        for key, value in result:
            if re.fullmatch(r"0|-?[1-9][0-9]*", key) and -(2**63) <= int(key) < 2**63:
                key = str(next_index)
                next_index += 1
            settings[key] = value
        return settings

    async def setting(self, user_id: int, key: str) -> Any:
        result = await self.session.execute(
            text('SELECT value FROM user_settings WHERE user_id=:user_id AND "key"=:key'),
            {"user_id": user_id, "key": key},
        )
        row = result.first()
        return row[0] if row is not None else client_defaults()["user_settings"].get(key)

    async def set_setting(self, user_id: int, key: str, value: Any) -> None:
        async with self._write():
            existing = await self.session.scalar(
                text('SELECT id FROM user_settings WHERE user_id=:user_id AND "key"=:key'),
                {"user_id": user_id, "key": key},
            )
            column = "value_id" if isinstance(value, (dict, list)) else "value"
            statement = (
                f'INSERT INTO user_settings(user_id,"key",{column}) VALUES (:user_id,:key,:value)'
                if existing is None
                else f"UPDATE user_settings SET {column}=:value,row_updated_timestamp=:updated "
                "WHERE id=:id"
            )
            await self.session.execute(
                text(statement),
                {
                    "id": existing,
                    "user_id": user_id,
                    "key": key,
                    "value": None if isinstance(value, (dict, list)) else value,
                    "updated": datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S"),
                },
            )

    async def delete_setting(self, user_id: int, key: str) -> None:
        async with self._write():
            await self.session.execute(
                text('DELETE FROM user_settings WHERE user_id=:user_id AND "key"=:key'),
                {"user_id": user_id, "key": key},
            )

    async def permissions(self, user_id: str) -> list[dict[str, Any]]:
        projection = ",".join(f'"{name}"' for name in SCHEMA["tables"]["user_permissions"])
        result = await self.session.execute(
            text(f"SELECT {projection} FROM user_permissions WHERE user_id=:user_id"),
            {"user_id": user_id},
        )
        return [dict(row) for row in result.mappings()]

    async def add_permission(self, user_id: str, value: Any) -> None:
        async with self._write():
            column = "permission_id_id" if isinstance(value, (dict, list)) else "permission_id"
            await self.session.execute(
                text(
                    f"INSERT INTO user_permissions(user_id,{column}) "
                    "VALUES (:user_id,:permission_id)"
                ),
                {
                    "user_id": user_id,
                    "permission_id": None
                    if isinstance(value, (dict, list))
                    else _permission(value),
                },
            )

    async def set_permissions(self, user_id: str, values: Any) -> None:
        async with self._write():
            await self.session.execute(
                text("DELETE FROM user_permissions WHERE user_id=:user_id"), {"user_id": user_id}
            )
        if get_settings().mode in {"demo", "prerelease"}:
            permissions = [1]
        elif isinstance(values, dict):
            permissions = [_permission(value) for value in values.values()]
        elif isinstance(values, list):
            permissions = [_permission(value) for value in values]
        else:
            permissions = []
        if permissions:
            async with self._write():
                connection = await self.session.connection()
                await connection.exec_driver_sql(
                    "INSERT INTO user_permissions(user_id,permission_id) VALUES "
                    + ",".join("(?,?)" for _ in permissions),
                    tuple(
                        value for permission_id in permissions for value in (user_id, permission_id)
                    ),
                )
