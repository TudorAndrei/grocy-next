from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import UnauthorizedError
from grocy.db.models.users import ApiKey
from grocy.db.session import get_session_factory


async def get_db_session() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def require_api_key(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    grocy_api_key: Annotated[str | None, Header(alias="GROCY-API-KEY")] = None,
) -> Actor:
    settings = get_settings()
    key = grocy_api_key or request.headers.get(settings.api_key_header)
    if not key:
        raise UnauthorizedError("Missing API key")
    if settings.dev_open_api_key and key == settings.dev_open_api_key:
        return Actor(user_id=1, username="admin", api_key=key, is_admin=True)
    stmt = (
        select(ApiKey)
        .options(selectinload(ApiKey.user))
        .where(ApiKey.api_key == key)
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        raise UnauthorizedError("Invalid API key")
    if row.expires is not None and row.expires < datetime.now():
        raise UnauthorizedError("API key expired")
    return Actor(
        user_id=row.user_id,
        username=row.user.username,
        api_key=key,
        is_admin=True,
    )


CurrentActor = Annotated[Actor, Depends(require_api_key)]
