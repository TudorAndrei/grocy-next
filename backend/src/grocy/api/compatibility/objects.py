from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.input import database_error, json_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["objects"])


@router.get("/api/objects/{entity}")
async def list_objects(
    entity: str, request: Request, _actor: CurrentActor, session: DbSession
) -> list[dict[str, Any]] | dict[str, Any]:
    return await GenericObjectsService(session).read_objects(
        entity, query_string=request.scope["query_string"]
    )


@router.post("/api/objects/{entity}")
async def create_object(
    entity: str, request: Request, _actor: CurrentActor, session: DbSession
) -> dict[str, str]:
    try:
        return await GenericObjectsService(session).create_entity(entity, await json_body(request))
    except DBAPIError as error:
        await session.rollback()
        raise database_error(error) from error


@router.get("/api/objects/{entity}/{object_id}")
async def get_object(
    entity: str, object_id: str, _actor: CurrentActor, session: DbSession
) -> dict[str, Any] | list[dict[str, Any]]:
    return await GenericObjectsService(session).read_objects(entity, object_id)


@router.put("/api/objects/{entity}/{object_id}", status_code=204)
async def update_object(
    entity: str, object_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    try:
        await GenericObjectsService(session).update_entity(
            entity, object_id, await json_body(request)
        )
    except DBAPIError as error:
        await session.rollback()
        raise database_error(error) from error
    return Response(status_code=204)


@router.delete("/api/objects/{entity}/{object_id}", status_code=204)
async def delete_object(
    entity: str, object_id: str, _actor: CurrentActor, session: DbSession
) -> Response:
    try:
        await GenericObjectsService(session).delete_entity(entity, object_id)
    except DBAPIError as error:
        await session.rollback()
        raise database_error(error, status_code=500) from error
    return Response(status_code=204)
