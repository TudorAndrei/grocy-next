from typing import Any

from fastapi import APIRouter, Response

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["userfields"])


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str,
    object_id: str,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str | None]:
    service = GenericObjectsService(session)
    reference = _reference(entity, object_id)
    await service.validate_userfield_object(entity, reference)
    return await service.userfields(entity, reference)


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
async def put_userfields(
    entity: str,
    object_id: str,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    service = GenericObjectsService(session)
    reference = _reference(entity, object_id)
    await service.validate_userfield_object(entity, reference)
    await service.write_userfields(entity, reference, body)
    await session.commit()
    return Response(status_code=204)


def _reference(entity: str, object_id: str) -> int | str:
    if entity == "stock":
        return object_id
    try:
        return int(object_id)
    except ValueError as exc:
        raise GrocyError("Object ID must be an integer") from exc
