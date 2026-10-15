from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.filtering import filter_rows
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
) -> list[dict[str, Any]]:
    service = GenericObjectsService(session)
    rows = await service.list_entity(entity)
    for row in rows:
        row["userfields"] = await service.userfields(
            entity, row["stock_id"] if entity == "stock" else row["id"]
        )
    try:
        return filter_rows(rows, request.query_params)
    except GrocyError as exc:
        # GetObjects lets query errors reach PHP's top-level error handler.
        raise GrocyError(exc.message, status_code=500, code=exc.code) from exc


@router.post("/api/objects/{entity}")
async def create_object(
    entity: str,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    return await GenericObjectsService(session).create_entity(entity, body)


@router.get("/api/objects/{entity}/{object_id}")
async def get_object(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    service = GenericObjectsService(session)
    row = await service.get_entity(entity, object_id)
    row["userfields"] = await service.userfields(
        entity, row["stock_id"] if entity == "stock" else object_id
    )
    return row


@router.put("/api/objects/{entity}/{object_id}", status_code=204)
async def update_object(
    entity: str,
    object_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    await GenericObjectsService(session).update_entity(entity, object_id, body)
    return Response(status_code=204)


@router.delete("/api/objects/{entity}/{object_id}", status_code=204)
async def delete_object(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    await GenericObjectsService(session).delete_entity(entity, object_id)
    return Response(status_code=204)
