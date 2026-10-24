"""First-run setup: create the first administrator from the web UI."""

import secrets

import bcrypt
from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from grocy.core.deps import DbSession
from grocy.core.errors import ConflictError
from grocy.db.models.users import ApiKey, User, UserPermission
from grocy.db.seed import has_ever_had_users

router = APIRouter(tags=["setup"])

ADMIN_PERMISSION_ID = 1


class SetupBody(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=72)
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)


@router.get("/setup")
async def setup_status(session: DbSession) -> dict[str, bool]:
    return {"needs_setup": not await has_ever_had_users(session)}


@router.post("/setup", status_code=201)
async def run_setup(body: SetupBody, session: DbSession) -> dict:
    # POST sessions hold the SQLite write lock, so two first-run requests cannot both pass.
    if await has_ever_had_users(session):
        raise ConflictError("Setup is already complete")
    hashed = await run_in_threadpool(bcrypt.hashpw, body.password.encode(), bcrypt.gensalt())
    user = User(
        username=body.username.strip(),
        first_name=body.first_name,
        last_name=body.last_name,
        password=hashed.decode().replace("$2b$", "$2y$", 1),
    )
    session.add(user)
    await session.flush()
    key = secrets.token_urlsafe(32)
    session.add_all(
        [
            UserPermission(user_id=user.id, permission_id=ADMIN_PERMISSION_ID),
            ApiKey(user_id=user.id, api_key=key, key_type="grocy-next", description="Setup wizard"),
        ]
    )
    await session.commit()
    return {"user_id": user.id, "username": user.username, "api_key": key}
