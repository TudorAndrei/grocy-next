from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.grocycode import code_response
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.recipes.presentation import (
    RecipeListItem,
    RecipeView,
    recipe_overview,
    recipe_view,
)

router = APIRouter(tags=["recipes"])


@router.get("/recipes/{recipe_id}/grocycode")
async def get_recipe_code(recipe_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:r:{recipe_id}")


@router.get("/recipes/overview")
async def get_recipe_overview(
    _actor: AuthenticatedActor, session: DbSession
) -> list[RecipeListItem]:
    return await recipe_overview(session)


@router.get("/recipes/{recipe_id}/view")
async def get_recipe_view(
    recipe_id: int, _actor: AuthenticatedActor, session: DbSession
) -> RecipeView:
    return await recipe_view(session, recipe_id)
