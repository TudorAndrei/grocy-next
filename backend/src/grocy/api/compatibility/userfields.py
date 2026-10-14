from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.db.models.settings import UserfieldValue
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["userfields"])


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str]:
    await GenericObjectsService(session).get_entity(entity, object_id)
    stmt = select(UserfieldValue).where(
        UserfieldValue.entity == entity,
        UserfieldValue.object_id == object_id,
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {row.name: row.value for row in rows}


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
async def put_userfields(
    entity: str,
    object_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    service = GenericObjectsService(session)
    await service.get_entity(entity, object_id)
    await service.write_userfields(entity, object_id, body)
    await session.commit()
    return Response(status_code=204)
