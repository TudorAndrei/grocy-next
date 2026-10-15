from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.input import CompatibilityRoute, filtered_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["userfields"], route_class=CompatibilityRoute)


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str,
    object_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, str | None] | list:
    service = GenericObjectsService(session)
    await service.validate_userfield_entity(entity)
    fields, values = await service.userfield_data(entity, object_id)
    responses = await request.app.state.input_purifier.userfield_responses(
        fields, values, [object_id]
    )
    return responses[0]


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
@filtered_body()
async def put_userfields(
    entity: str,
    object_id: str,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    service = GenericObjectsService(session)
    await service.validate_userfield_entity(entity)
    await service.write_userfields(entity, object_id, body, commit_each=True)
    await session.commit()
    return Response(status_code=204)
