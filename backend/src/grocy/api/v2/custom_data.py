"""Authenticated presentation reads for native custom-data pages."""

from typing import Any

from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.catalog.custom_data import (
    custom_data_catalog,
    custom_data_fields,
    userobjects_context,
)

router = APIRouter(tags=["custom-data"])


@router.get("/custom-data/catalog")
async def catalog(_actor: AuthenticatedActor, session: DbSession) -> dict[str, list[str]]:
    return await custom_data_catalog(session)


@router.get("/custom-data/userobjects/{name}")
async def userobjects(name: str, _actor: AuthenticatedActor, session: DbSession) -> dict[str, Any]:
    return await userobjects_context(session, name)


@router.get("/custom-data/fields")
async def fields(_actor: AuthenticatedActor, session: DbSession) -> list[dict[str, Any]]:
    return await custom_data_fields(session)
