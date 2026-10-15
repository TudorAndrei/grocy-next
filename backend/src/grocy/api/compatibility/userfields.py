from typing import Any

from fastapi import APIRouter, Response

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["userfields"])


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str | None]:
    service = GenericObjectsService(session)
    await service.validate_userfield_object(entity, object_id)
    return await service.userfields(entity, object_id)


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
async def put_userfields(
    entity: str,
    object_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    service = GenericObjectsService(session)
    await service.validate_userfield_object(entity, object_id)
    await service.write_userfields(entity, object_id, body)
    await session.commit()
    return Response(status_code=204)
