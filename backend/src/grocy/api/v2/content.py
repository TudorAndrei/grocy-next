"""Formatted descriptions for web views, separate from stored compatibility values."""

from typing import Literal

from fastapi import APIRouter

from grocy.compatibility.sanitizer import render_html
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.db.models.equipment import Equipment
from grocy.db.models.recipes import Recipe

router = APIRouter(tags=["content"])


@router.get("/content/{entity}/{object_id}")
async def formatted_description(
    entity: Literal["recipes", "equipment"],
    object_id: int,
    actor: AuthenticatedActor,
    session: DbSession,
) -> dict[str, str]:
    actor.require("RECIPES" if entity == "recipes" else "EQUIPMENT")
    model = Recipe if entity == "recipes" else Equipment
    row = await session.get(model, object_id)
    if row is None:
        raise NotFoundError("Record not found")
    return {"html": render_html(row.description or "")}
