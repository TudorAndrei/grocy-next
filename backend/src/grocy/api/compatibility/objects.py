from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.api.compatibility.responses import native_response
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["objects"])


@router.get("/api/objects/{entity}")
async def list_objects(
    entity: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    result = await GenericObjectsService(session).read_objects(
        entity, None, request.scope["query_string"], request.app.state.input_purifier
    )
    return native_response(result)


@router.post("/api/objects/{entity}")
async def create_object(
    entity: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    try:
        result = await GenericObjectsService(session).create_entity(
            entity,
            await request.body(),
            request.app.state.input_purifier,
            ", ".join(request.headers.getlist("content-type")),
        )
    except DBAPIError as error:
        await session.rollback()
        raise _database_error(error) from error
    return {"created_object_id": str(result["created_object_id"])}


@router.get("/api/objects/{entity}/{object_id}")
async def get_object(
    entity: str,
    object_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    result = await GenericObjectsService(session).read_objects(
        entity, object_id, request.scope["query_string"], request.app.state.input_purifier
    )
    return native_response(result)


@router.put("/api/objects/{entity}/{object_id}", status_code=204)
async def update_object(
    entity: str,
    object_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    try:
        await GenericObjectsService(session).update_entity(
            entity,
            object_id,
            await request.body(),
            request.app.state.input_purifier,
            ", ".join(request.headers.getlist("content-type")),
        )
    except DBAPIError as error:
        await session.rollback()
        raise _database_error(error) from error
    return Response(status_code=204)


def _database_error(error: DBAPIError) -> GrocyError:
    number = getattr(error.orig, "sqlite_errorcode", 1) & 255
    state = "23000]: Integrity constraint violation" if number == 19 else "HY000]: General error"
    return GrocyError(f"SQLSTATE[{state}: {number} {error.orig}", code=None)


@router.delete("/api/objects/{entity}/{object_id}", status_code=204)
async def delete_object(
    entity: str,
    object_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    try:
        await GenericObjectsService(session).delete_entity(
            entity, object_id, request.app.state.input_purifier
        )
    except DBAPIError as error:
        await session.rollback()
        raise GrocyError(_database_error(error).message, status_code=500, code=None) from error
    return Response(status_code=204)
