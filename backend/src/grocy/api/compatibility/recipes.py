from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from grocy.api.compatibility.input import CompatibilityBody, CompatibilityRoute, filtered_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import RecipesSvc

router = APIRouter(tags=["recipes"], route_class=CompatibilityRoute)


class RecipeShoppingBody(CompatibilityBody):
    excludedProductIds: list[int] = Field(default_factory=list)


class RecipeCreateBody(BaseModel):
    name: str
    description: str | None = None
    base_servings: Decimal = Field(default=Decimal("1"), gt=0)
    positions: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/api/recipes/fulfillment")
async def recipes_fulfillment(_actor: CurrentActor, recipes: RecipesSvc) -> list[dict[str, Any]]:
    return [recipes.serialize(recipe) for recipe in await recipes.list_recipes()]


@router.get("/api/recipes/{recipe_id}/fulfillment")
async def recipe_fulfillment(
    recipe_id: int,
    _actor: CurrentActor,
    recipes: RecipesSvc,
    servings: Annotated[Decimal | None, Query()] = None,
) -> dict[str, Any]:
    return await recipes.fulfillment(recipe_id, servings=servings)


@router.post("/api/recipes/{recipe_id}/consume", status_code=204)
async def recipe_consume(
    recipe_id: int,
    actor: CurrentActor,
    recipes: RecipesSvc,
    servings: Annotated[Decimal | None, Query()] = None,
) -> Response:
    await recipes.consume(actor, recipe_id, servings=servings)
    return Response(status_code=204)


@router.post("/api/recipes/{recipe_id}/add-not-fulfilled-products-to-shoppinglist", status_code=204)
async def recipe_add_missing(
    recipe_id: int,
    _actor: CurrentActor,
    recipes: RecipesSvc,
    servings: Annotated[Decimal | None, Query()] = None,
) -> Response:
    await recipes.add_missing_to_shopping_list(recipe_id, servings=servings)
    return Response(status_code=204)


@router.post("/api/recipes/{recipe_id}/copy")
async def recipe_copy(recipe_id: int, _actor: CurrentActor, recipes: RecipesSvc) -> dict[str, Any]:
    recipe = await recipes.get(recipe_id)
    copy = await recipes.create(
        f"{recipe.name} (copy)",
        description=recipe.description,
        base_servings=recipe.base_servings,
    )
    return {"created_object_id": str(copy.id)}


@router.get("/api/v2/recipes/{recipe_id}/fulfillment")
async def scaled_recipe_fulfillment(
    recipe_id: int,
    _actor: CurrentActor,
    recipes: RecipesSvc,
    servings: Annotated[Decimal | None, Query()] = None,
) -> dict[str, Any]:
    return await recipes.fulfillment(recipe_id, servings=servings)


@router.post("/api/v2/recipes/{recipe_id}/consume", status_code=204)
async def scaled_recipe_consume(
    recipe_id: int,
    actor: CurrentActor,
    recipes: RecipesSvc,
    servings: Annotated[Decimal | None, Query()] = None,
) -> Response:
    await recipes.consume(actor, recipe_id, servings=servings)
    return Response(status_code=204)


@router.post(
    "/api/v2/recipes/{recipe_id}/add-not-fulfilled-products-to-shoppinglist", status_code=204
)
@filtered_body(null_status=None)
async def scaled_recipe_add_missing(
    recipe_id: int,
    _actor: CurrentActor,
    recipes: RecipesSvc,
    body: RecipeShoppingBody | None = None,
    servings: Annotated[Decimal | None, Query()] = None,
) -> Response:
    await recipes.add_missing_to_shopping_list(
        recipe_id,
        servings=servings,
        excluded_product_ids=body.excludedProductIds if body else None,
    )
    return Response(status_code=204)


@router.post("/api/v2/recipes")
async def create_recipe(
    body: RecipeCreateBody,
    _actor: CurrentActor,
    recipes: RecipesSvc,
) -> dict[str, Any]:
    recipe = await recipes.create(
        body.name,
        description=body.description,
        base_servings=body.base_servings,
        positions=body.positions,
    )
    return recipes.serialize(recipe)
