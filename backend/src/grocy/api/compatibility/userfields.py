from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.input import CompatibilityRoute, filtered_body
from grocy.api.compatibility.responses import native_response
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
) -> Response:
    result = await GenericObjectsService(session).get_userfields(
        entity, object_id, request.app.state.input_purifier
    )
    return native_response(result)


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
@filtered_body()
async def put_userfields(
    entity: str,
    object_id: str,
    body: dict[str, Any],
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    service = GenericObjectsService(session)
    await service.write_userfields(entity, object_id, body, request.app.state.input_purifier)
    return Response(status_code=204)
