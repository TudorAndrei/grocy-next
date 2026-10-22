from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.input import database_error, json_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.objects import GenericObjectsService, field_response

router = APIRouter(tags=["userfields"])


@router.get("/api/userfields/{entity}/{object_id}")
async def get_userfields(
    entity: str, object_id: str, _actor: CurrentActor, session: DbSession
) -> dict[str, Any] | list[Any]:
    return field_response(await GenericObjectsService(session).get_userfields(entity, object_id))


@router.put("/api/userfields/{entity}/{object_id}", status_code=204)
async def put_userfields(
    entity: str, object_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    try:
        await GenericObjectsService(session).write_userfields(
            entity, object_id, await json_body(request)
        )
    except DBAPIError as error:
        await session.rollback()
        raise database_error(error) from error
    return Response(status_code=204)
