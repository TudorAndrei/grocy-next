import secrets
from datetime import datetime

from fastapi import APIRouter, Response
from pydantic import BaseModel
from sqlalchemy import select

from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError, NotFoundError
from grocy.core.permissions import PERMISSIONS
from grocy.db.models.users import ApiKey, User

router = APIRouter(tags=["access"])


@router.get("/user/permissions")
async def own_permissions(actor: AuthenticatedActor) -> dict[str, bool]:
    return {
        name: actor.is_admin or name in actor.permissions for name, _parent in PERMISSIONS.values()
    }


class CreateKey(BaseModel):
    user_id: int
    description: str | None = None
    expires: datetime | None = None


@router.get("/api-keys")
async def list_keys(actor: CurrentActor, session: DbSession) -> list[dict]:
    actor.require("ADMIN")
    rows = (await session.execute(select(ApiKey).order_by(ApiKey.id))).scalars().all()
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "description": row.description,
            "expires": row.expires.isoformat() if row.expires else None,
        }
        for row in rows
    ]


@router.post("/api-keys")
async def create_key(body: CreateKey, actor: CurrentActor, session: DbSession) -> dict:
    actor.require("ADMIN")
    if await session.get(User, body.user_id) is None:
        raise NotFoundError("User not found")
    expires = body.expires
    if expires and expires.tzinfo:
        from datetime import UTC

        expires = expires.astimezone(UTC).replace(tzinfo=None)
    row = ApiKey(
        user_id=body.user_id,
        api_key=secrets.token_urlsafe(32),
        key_type="grocy-next",
        description=body.description,
        expires=expires,
    )
    session.add(row)
    await session.commit()
    return {"id": row.id, "api_key": row.api_key, "user_id": row.user_id}


@router.delete("/api-keys/{key_id}")
async def delete_key(key_id: int, actor: CurrentActor, session: DbSession) -> Response:
    actor.require("ADMIN")
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise NotFoundError("API key not found")
    if row.api_key == actor.api_key:
        raise GrocyError("Cannot delete the API key used for this request")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
