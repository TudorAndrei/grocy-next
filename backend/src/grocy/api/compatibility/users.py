from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.db.models.settings import UserSetting
from grocy.db.models.users import ApiKey, User

router = APIRouter(tags=["users"])

ALL_PERMISSION_IDS = list(range(1, 16))
_user_permissions: dict[int, list[int]] = {}


def _serialize_user(user: User) -> dict[str, Any]:
    parts = [user.first_name or "", user.last_name or ""]
    display = " ".join(part for part in parts if part).strip() or user.username
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "display_name": display,
        "picture_file_name": user.picture_file_name or "",
        "row_created_timestamp": user.row_created_timestamp.isoformat(),
    }


async def _get_user_or_404(session: DbSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"User {user_id} not found")
    return user


async def _settings_map(session: DbSession, user_id: int) -> dict[str, str]:
    stmt = select(UserSetting).where(UserSetting.user_id == user_id)
    rows = (await session.execute(stmt)).scalars().all()
    return {row.key: row.value for row in rows}


@router.get("/api/user")
async def get_current_user(actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    user = await _get_user_or_404(session, actor.user_id)
    return _serialize_user(user)


@router.get("/api/user/settings")
async def get_user_settings(actor: CurrentActor, session: DbSession) -> dict[str, str]:
    return await _settings_map(session, actor.user_id)


@router.put("/api/user/settings")
async def put_user_settings(
    body: dict[str, Any],
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, str]:
    stmt = select(UserSetting).where(UserSetting.user_id == actor.user_id)
    existing = {row.key: row for row in (await session.execute(stmt)).scalars().all()}
    for key, value in body.items():
        text = "" if value is None else str(value)
        row = existing.get(key)
        if row is None:
            session.add(UserSetting(user_id=actor.user_id, key=key, value=text))
        else:
            row.value = text
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
    if row is None:
        raise NotFoundError(f"Setting '{setting_key}' not found")
    return {
        "id": row.id,
        "user_id": row.user_id,
        "key": row.key,
        "value": row.value,
    }


@router.put("/api/user/settings/{setting_key}")
async def put_user_setting(
    setting_key: str,
    body: dict[str, Any],
    actor: CurrentActor,
    session: DbSession,
) -> Response:
    value = body.get("value", "")
    stmt = select(UserSetting).where(
        UserSetting.user_id == actor.user_id,
        UserSetting.key == setting_key,
    )
    row = (await session.execute(stmt)).scalars().first()
    text = "" if value is None else str(value)
    if row is None:
        session.add(UserSetting(user_id=actor.user_id, key=setting_key, value=text))
    else:
        row.value = text
    await session.commit()
    return Response(status_code=204)


@router.delete("/api/user/settings/{setting_key}")
async def delete_user_setting(
    setting_key: str,
    actor: CurrentActor,
    session: DbSession,
) -> Response:
    stmt = select(UserSetting).where(
        UserSetting.user_id == actor.user_id,
        UserSetting.key == setting_key,
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        raise NotFoundError(f"Setting '{setting_key}' not found")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.get("/api/users")
async def list_users(_actor: CurrentActor, session: DbSession) -> list[dict[str, Any]]:
    rows = (await session.execute(select(User).order_by(User.id))).scalars().all()
    return [_serialize_user(row) for row in rows]


@router.post("/api/users")
async def create_user(
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    user = User(
        username=str(body.get("username", "")),
        first_name=body.get("first_name"),
        last_name=body.get("last_name"),
        password=str(body.get("password", "")),
        picture_file_name=body.get("picture_file_name"),
    )
    session.add(user)
    await session.commit()
    return Response(status_code=204)


@router.put("/api/users/{user_id}")
async def update_user(
    user_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    user = await _get_user_or_404(session, user_id)
    if "username" in body:
        user.username = str(body["username"])
    if "first_name" in body:
        user.first_name = body["first_name"]
    if "last_name" in body:
        user.last_name = body["last_name"]
    if "password" in body:
        user.password = str(body["password"])
    if "picture_file_name" in body:
        user.picture_file_name = body["picture_file_name"]
    await session.commit()
    return Response(status_code=204)


@router.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    actor: CurrentActor,
    session: DbSession,
) -> Response:
    if user_id == actor.user_id:
        raise NotFoundError("Cannot delete current user")
    user = await _get_user_or_404(session, user_id)
    keys = (await session.execute(select(ApiKey).where(ApiKey.user_id == user_id))).scalars().all()
    for key in keys:
        await session.delete(key)
    settings = (
        await session.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    ).scalars().all()
    for setting in settings:
        await session.delete(setting)
    await session.delete(user)
    _user_permissions.pop(user_id, None)
    await session.commit()
    return Response(status_code=204)


def _permission_rows(user_id: int, permission_ids: list[int]) -> list[dict[str, int]]:
    return [{"permission_id": pid, "user_id": user_id} for pid in permission_ids]


@router.get("/api/users/{user_id}/permissions")
async def get_user_permissions(user_id: int, _actor: CurrentActor) -> list[dict[str, int]]:
    stored = _user_permissions.get(user_id)
    if stored is not None:
        return _permission_rows(user_id, stored)
    return _permission_rows(user_id, ALL_PERMISSION_IDS)


@router.post("/api/users/{user_id}/permissions")
async def add_user_permission(
    user_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
) -> Response:
    permission_id = int(body.get("permission_id") or body.get("permissions_id") or 0)
    current = _user_permissions.setdefault(user_id, list(ALL_PERMISSION_IDS))
    if permission_id and permission_id not in current:
        current.append(permission_id)
    return Response(status_code=204)


@router.put("/api/users/{user_id}/permissions")
async def set_user_permissions(
    user_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
) -> list[dict[str, int]]:
    raw = body.get("permissions") or body.get("permission_ids") or ALL_PERMISSION_IDS
    ids = [int(item) for item in raw] if isinstance(raw, list) else list(ALL_PERMISSION_IDS)
    _user_permissions[user_id] = ids
    return _permission_rows(user_id, ids)
