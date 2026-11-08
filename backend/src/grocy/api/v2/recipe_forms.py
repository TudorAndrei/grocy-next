"""Authenticated presentation contexts used by the native recipe forms."""

from typing import Any

from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.recipes.forms import recipe_form_context, recipe_ingredient_context

router = APIRouter(tags=["recipes"])


@router.get("/recipes/editor")
async def get_recipe_editor(
    _actor: AuthenticatedActor, session: DbSession, recipe_id: int | None = None
) -> dict[str, Any]:
    return await recipe_form_context(session, recipe_id)


@router.get("/recipes/ingredient-editor")
async def get_ingredient_editor(
    recipe_id: int,
    _actor: AuthenticatedActor,
    session: DbSession,
    position_id: int | None = None,
) -> dict[str, Any]:
    return await recipe_ingredient_context(session, recipe_id, position_id)
