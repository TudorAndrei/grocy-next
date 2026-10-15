import hashlib
import json
import math
import secrets
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError

from grocy.api.compatibility.input import CompatibilityRoute, filtered_body
from grocy.api.compatibility.responses import native_list_response
from grocy.compatibility import client_defaults
from grocy.compatibility.users import user_dto
from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError, NotFoundError
from grocy.core.permissions import PERMISSIONS
from grocy.db.models.settings import UserSetting
from grocy.db.models.users import User, UserPermission

router = APIRouter(tags=["users"], route_class=CompatibilityRoute)


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _username(body: dict[str, Any]) -> str:
    value = str(body.get("username", "")).strip()
    if not value:
        raise GrocyError("Username is required")
    return value


async def _get_user_or_404(session: DbSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"User {user_id} not found")
    return user


async def _settings_map(session: DbSession, user_id: int) -> dict[str, Any]:
    stmt = select(UserSetting).where(UserSetting.user_id == user_id)
    rows = (await session.execute(stmt)).scalars().all()
    return {**client_defaults()["user_settings"], **{row.key: row.value for row in rows}}


def _setting_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        if not math.isfinite(value):
            raise GrocyError("A setting number must be finite")
        return format(value, ".14g")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


@router.get("/api/user")
async def get_current_user(actor: CurrentActor, session: DbSession) -> list[dict[str, Any]]:
    user = await _get_user_or_404(session, actor.user_id)
    return [user_dto(user)]


@router.get("/api/user/settings")
async def get_user_settings(actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    return await _settings_map(session, actor.user_id)


@router.put("/api/user/settings")
async def put_user_settings(
    body: dict[str, Any],
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    stmt = select(UserSetting).where(UserSetting.user_id == actor.user_id)
    existing = {row.key: row for row in (await session.execute(stmt)).scalars().all()}
    for key, value in body.items():
        text = _setting_text(value)
        row = existing.get(key)
        if row is None:
            session.add(UserSetting(user_id=actor.user_id, key=key, value=text))
        else:
            row.value = text
            row.row_updated_timestamp = datetime.now()
    await session.commit()
    return await _settings_map(session, actor.user_id)


@router.delete("/api/user/settings")
async def delete_user_settings(actor: CurrentActor, session: DbSession) -> Response:
    stmt = select(UserSetting).where(UserSetting.user_id == actor.user_id)
    rows = (await session.execute(stmt)).scalars().all()
    for row in rows:
        await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.get("/api/user/settings/{setting_key}")
async def get_user_setting(
    setting_key: str,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    stmt = select(UserSetting).where(
        UserSetting.user_id == actor.user_id,
        UserSetting.key == setting_key,
    )
    row = (await session.execute(stmt)).scalars().first()
    return {
        "value": row.value
        if row is not None
        else client_defaults()["user_settings"].get(setting_key)
    }


@router.put("/api/user/settings/{setting_key}", status_code=204)
@filtered_body(null_status=None)
async def put_user_setting(
    setting_key: str,
    body: dict[str, Any],
    actor: CurrentActor,
    session: DbSession,
) -> Response:
    value = body.get("value")
    stmt = select(UserSetting).where(
        UserSetting.user_id == actor.user_id,
        UserSetting.key == setting_key,
    )
    row = (await session.execute(stmt)).scalars().first()
    text = _setting_text(value)
    if row is None:
        session.add(UserSetting(user_id=actor.user_id, key=setting_key, value=text))
    else:
        row.value = text
        row.row_updated_timestamp = datetime.now()
    await session.commit()
    return Response(status_code=204)


@router.delete("/api/user/settings/{setting_key}", status_code=204)
async def delete_user_setting(
    setting_key: str,
    actor: CurrentActor,
    session: DbSession,
) -> Response:
    await session.execute(
        delete(UserSetting).where(
            UserSetting.user_id == actor.user_id,
            UserSetting.key == setting_key,
        )
    )
    await session.commit()
    return Response(status_code=204)


@router.get("/api/users")
async def list_users(
    request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return await native_list_response(request, session, "users")


@router.post("/api/users", status_code=204)
@filtered_body()
async def create_user(
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    user = User(
        username=_username(body),
        first_name=body.get("first_name"),
        last_name=body.get("last_name"),
        password=_hash_password(str(body.get("password", ""))),
        picture_file_name=body.get("picture_file_name"),
    )
    session.add(user)
    await session.flush()
    defaults = get_settings().default_permissions
    if any(name not in {record[0] for record in PERMISSIONS.values()} for name in defaults):
        raise GrocyError("Unknown default permission")
    session.add_all(
        [
            UserPermission(user_id=user.id, permission_id=permission_id)
            for permission_id, (name, _) in PERMISSIONS.items()
            if name in defaults
        ]
    )
    await session.commit()
    return Response(status_code=204)


@router.put("/api/users/{user_id}", status_code=204)
@filtered_body(null_status=500)
async def update_user(
    user_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    user = await _get_user_or_404(session, user_id)
    if "username" in body:
        user.username = _username(body)
    if "first_name" in body:
        user.first_name = body["first_name"]
    if "last_name" in body:
        user.last_name = body["last_name"]
    if body.get("password") and body["password"] != "0":
        user.password = _hash_password(str(body["password"]))
    if "picture_file_name" in body:
        user.picture_file_name = body["picture_file_name"]
    await session.commit()
    return Response(status_code=204)


@router.delete("/api/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    user = await session.get(User, user_id)
    if user is None:
        raise GrocyError("Call to a member function delete() on null", status_code=500, code=None)
    await session.delete(user)
    await session.commit()
    return Response(status_code=204)


@router.get("/api/users/{user_id}/permissions")
async def get_user_permissions(
    user_id: str, _actor: CurrentActor, session: DbSession
) -> list[dict[str, Any]]:
    rows = (
        await session.scalars(select(UserPermission).where(UserPermission.user_id == user_id))
    ).all()
    return [
        {"id": row.id, "permission_id": row.permission_id, "user_id": row.user_id} for row in rows
    ]


async def _write_permissions(request: Request, user_id: str, session: DbSession) -> Response:
    query = await request.app.state.input_purifier.permission_query(
        await request.body(),
        user_id=user_id,
        method=request.method,
        content_type=request.headers.get("content-type"),
    )
    if query["clear"]:
        await session.execute(delete(UserPermission).where(UserPermission.user_id == user_id))
        # Grocy commits this delete before the separate batch insert can fail.
        await session.commit()
    if "error_message" in query:
        raise GrocyError(query["error_message"], status_code=query["status"], code=None)
    if query["query"] is not None:
        try:
            connection = await session.connection()
            await connection.exec_driver_sql(query["query"], tuple(query["parameters"]))
            await session.commit()
        except DBAPIError as error:
            await session.rollback()
            number = getattr(error.orig, "sqlite_errorcode", 1) & 255
            state = (
                "23000]: Integrity constraint violation"
                if number == 19
                else "HY000]: General error"
            )
            raise GrocyError(f"SQLSTATE[{state}: {number} {error.orig}", code=None) from error
    return Response(status_code=204)


@router.post("/api/users/{user_id}/permissions", status_code=204)
async def add_user_permission(
    user_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return await _write_permissions(request, user_id, session)


@router.put("/api/users/{user_id}/permissions", status_code=204)
async def set_user_permissions(
    user_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return await _write_permissions(request, user_id, session)
