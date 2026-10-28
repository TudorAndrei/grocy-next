from fastapi import APIRouter

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.recipes.presentation import RecipeView, recipe_view

router = APIRouter(tags=["recipes"])


@router.get("/recipes/{recipe_id}/view")
async def get_recipe_view(recipe_id: int, _actor: CurrentActor, session: DbSession) -> RecipeView:
    return await recipe_view(session, recipe_id)
