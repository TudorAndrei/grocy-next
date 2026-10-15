from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.api.compatibility.filtering import filter_rows
from grocy.api.compatibility.input import CompatibilityRoute, filtered_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["objects"], route_class=CompatibilityRoute)


@router.get("/api/objects/{entity}")
async def list_objects(
    entity: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> list[dict[str, Any]]:
    service = GenericObjectsService(session)
    rows = await service.list_entity(entity)
    fields, values = await service.userfield_data(entity)
    if fields:
        responses = await request.app.state.input_purifier.userfield_responses(
            fields,
            values,
            [row["stock_id"] if entity == "stock" else row["id"] for row in rows],
            listing=True,
        )
        for row, response in zip(rows, responses, strict=True):
            row["userfields"] = response
    try:
        return filter_rows(rows, request.query_params)
    except GrocyError as exc:
        # GetObjects lets query errors reach PHP's top-level error handler.
        raise GrocyError(exc.message, status_code=500, code=exc.code) from exc


@router.post("/api/objects/{entity}")
@filtered_body()
async def create_object(
    entity: str,
    body: dict[str, Any],
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    try:
        result = await GenericObjectsService(session).create_entity(
            entity, body, request.app.state.input_purifier
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
) -> dict[str, Any]:
    service = GenericObjectsService(session)
    row = await service.get_entity(entity, object_id)
    fields, values = await service.userfield_data(
        entity, row["stock_id"] if entity == "stock" else object_id
    )
    responses = await request.app.state.input_purifier.userfield_responses(
        fields, values, [object_id]
    )
    row["userfields"] = responses[0] or None
    return row


@router.put("/api/objects/{entity}/{object_id}", status_code=204)
@filtered_body()
async def update_object(
    entity: str,
    object_id: str,
    body: dict[str, Any],
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    try:
        await GenericObjectsService(session).update_entity(
            entity, object_id, body, request.app.state.input_purifier
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
