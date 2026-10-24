"""First-run setup and password login for the web UI."""

import secrets
from functools import cache

import bcrypt
from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from starlette.concurrency import run_in_threadpool

from grocy.core.auth import AuthenticatedActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import ConflictError, GrocyError, UnauthorizedError
from grocy.db.models.users import ApiKey, User, UserPermission
from grocy.db.seed import has_ever_had_users

router = APIRouter(tags=["setup"])

ADMIN_PERMISSION_ID = 1
# Compared when the username is unknown, so both paths cost one bcrypt check.
_DUMMY_HASH = bcrypt.hashpw(b"grocy-next", bcrypt.gensalt())


@cache
def _generated_setup_token() -> str:
    return secrets.token_urlsafe(16)


def setup_token() -> str:
    """The configured token, or one generated per process and written to the log."""
    return get_settings().setup_token or _generated_setup_token()


class SetupBody(BaseModel):
    setup_token: str
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=72)
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)


class LoginBody(BaseModel):
    username: str
    password: str = Field(max_length=72)


async def _issue_key(session: DbSession, user_id: int, description: str) -> str:
    key = secrets.token_urlsafe(32)
    session.add(
        ApiKey(user_id=user_id, api_key=key, key_type="grocy-next", description=description)
    )
    return key


@router.get("/setup")
async def setup_status(session: DbSession) -> dict[str, bool]:
    return {"needs_setup": not await has_ever_had_users(session)}


@router.post("/setup", status_code=201)
async def run_setup(body: SetupBody, session: DbSession) -> dict:
    # POST sessions hold the SQLite write lock, so two first-run requests cannot both pass.
    if await has_ever_had_users(session):
        raise ConflictError("Setup is already complete")
    if not secrets.compare_digest(body.setup_token.strip(), setup_token()):
        raise GrocyError("Invalid setup token", status_code=403, code="forbidden")
    hashed = await run_in_threadpool(bcrypt.hashpw, body.password.encode(), bcrypt.gensalt())
    user = User(
        username=body.username.strip(),
        first_name=body.first_name,
        last_name=body.last_name,
        password=hashed.decode().replace("$2b$", "$2y$", 1),
    )
    session.add(user)
    await session.flush()
    session.add(UserPermission(user_id=user.id, permission_id=ADMIN_PERMISSION_ID))
    key = await _issue_key(session, user.id, "Setup wizard")
    await session.commit()
    return {"user_id": user.id, "username": user.username, "api_key": key}


@router.post("/login")
async def login(body: LoginBody, session: DbSession) -> dict:
    user = await session.scalar(select(User).where(User.username == body.username.strip()))
    stored = user.password.replace("$2y$", "$2b$", 1).encode() if user and user.password else None
    try:
        valid = await run_in_threadpool(
            bcrypt.checkpw, body.password.encode(), stored or _DUMMY_HASH
        )
    except ValueError:
        valid = False
    if user is None or stored is None or not valid:
        raise UnauthorizedError("Invalid username or password")
    key = await _issue_key(session, user.id, "Web login")
    await session.commit()
    return {"user_id": user.id, "username": user.username, "api_key": key}


@router.post("/logout", status_code=204)
async def logout(actor: AuthenticatedActor, session: DbSession) -> Response:
    if actor.api_key:
        await session.execute(
            delete(ApiKey).where(ApiKey.api_key == actor.api_key, ApiKey.key_type == "grocy-next")
        )
        await session.commit()
    return Response(status_code=204)
