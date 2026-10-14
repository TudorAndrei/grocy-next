from typing import Any

from fastapi import APIRouter, Response

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["objects"])


@router.get("/api/objects/{entity}")
async def list_objects(
    entity: str,
    _actor: CurrentActor,
    session: DbSession,
) -> list[dict[str, Any]]:
    return await GenericObjectsService(session).list_entity(entity)


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
    return await GenericObjectsService(session).get_entity(entity, object_id)


@router.put("/api/objects/{entity}/{object_id}")
async def update_object(
    entity: str,
    object_id: int,
    body: dict[str, Any],
    _actor: CurrentActor,
    session: DbSession,
) -> dict[str, Any]:
    return await GenericObjectsService(session).update_entity(entity, object_id, body)


@router.delete("/api/objects/{entity}/{object_id}")
async def delete_object(
    entity: str,
    object_id: int,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    await GenericObjectsService(session).delete_entity(entity, object_id)
    return Response(status_code=204)


@router.get("/api/system/info")
async def system_info(_actor: CurrentActor) -> dict[str, Any]:
    from grocy import __version__
    from grocy.core.config import get_settings
    from grocy.domains.catalog.objects import ENTITY_MODELS

    settings = get_settings()
    return {
        "grocy_version": {
            "Version": __version__,
            "ReleaseDate": "2026-10-14",
        },
        "compatibility_baseline": settings.grocy_baseline,
        "python_version": "3.13+",
        "modules": ["stock", "nutrition", "mcp", "recipes", "household", "units"],
        "exposed_entities": sorted(ENTITY_MODELS),
    }
