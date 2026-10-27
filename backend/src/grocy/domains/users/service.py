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
        raise GrocyError("Invalid permission", code=None)
    return int(value) if isinstance(value, bool) else value


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
                raise GrocyError("User does not exist", code=None)

    async def settings(self, user_id: int) -> dict[str, Any]:
        result = await self.session.execute(
            text('SELECT "key",value FROM user_settings WHERE user_id=:user_id'),
            {"user_id": user_id},
        )
        return {**client_defaults()["user_settings"], **dict(result.all())}

    async def setting(self, user_id: int, key: str) -> Any:
        return (await self.settings(user_id)).get(key)

    async def set_setting(self, user_id: int, key: str, value: Any) -> None:
        if isinstance(value, (dict, list)):
            raise GrocyError("Invalid setting value", code=None)
        async with self._write():
            existing = await self.session.scalar(
                text('SELECT id FROM user_settings WHERE user_id=:user_id AND "key"=:key'),
                {"user_id": user_id, "key": key},
            )
            statement = (
                'INSERT INTO user_settings(user_id,"key",value) VALUES (:user_id,:key,:value)'
                if existing is None
                else "UPDATE user_settings SET value=:value,row_updated_timestamp=:updated "
                "WHERE id=:id"
            )
            await self.session.execute(
                text(statement),
                {
                    "id": existing,
                    "user_id": user_id,
                    "key": key,
                    "value": value,
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
        permission_id = _permission(value)
        async with self._write():
            await self.session.execute(
                text(
                    "INSERT INTO user_permissions(user_id,permission_id) "
                    "VALUES (:user_id,:permission_id)"
                ),
                {"user_id": user_id, "permission_id": permission_id},
            )

    async def set_permissions(self, user_id: str, values: Any) -> None:
        if get_settings().mode in {"demo", "prerelease"}:
            permissions = [1]
        elif isinstance(values, dict):
            permissions = [_permission(value) for value in values.values()]
        elif isinstance(values, list):
            permissions = [_permission(value) for value in values]
        else:
            permissions = []
        async with self._write():
            await self.session.execute(
                text("DELETE FROM user_permissions WHERE user_id=:user_id"), {"user_id": user_id}
            )
            for permission_id in permissions:
                await self.session.execute(
                    text(
                        "INSERT INTO user_permissions(user_id,permission_id) "
                        "VALUES (:user_id,:permission_id)"
                    ),
                    {"user_id": user_id, "permission_id": permission_id},
                )
