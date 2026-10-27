from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from grocy.api.compatibility.input import CompatibilityBody, CompatibilityRoute, filtered_body
from grocy.compatibility.lessql import query_parameters, query_rows
from grocy.compatibility.php import PhpJSONResponse, body_array, php_error, request_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession, RecipesSvc
from grocy.core.errors import GrocyError
from grocy.db.compatibility_views import configure_compatibility_queries

router = APIRouter(tags=["recipes"], route_class=CompatibilityRoute)


class RecipeShoppingBody(CompatibilityBody):
    excludedProductIds: list[int] = Field(default_factory=list)


class RecipeCreateBody(BaseModel):
    name: str
    description: str | None = None
    base_servings: Decimal = Field(default=Decimal("1"), gt=0)
    positions: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/api/recipes/fulfillment")
async def recipes_fulfillment(
    request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    await configure_compatibility_queries(session)
    return PhpJSONResponse(
        await query_rows(
            session,
            "recipes_resolved",
            query_parameters(request.scope["query_string"]),
            caught=True,
        )
    )


@router.get("/api/recipes/{recipe_id}/fulfillment")
async def recipe_fulfillment(
    recipe_id: str,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    await configure_compatibility_queries(session)
    rows = await query_rows(
        session, "recipes_resolved", {}, where="recipe_id = ?", bindings=(recipe_id,), caught=True
    )
    if not rows:
        raise GrocyError("Recipe does not exist", code=None)
    return PhpJSONResponse(rows[0])


@router.post("/api/recipes/{recipe_id}/consume", status_code=204)
async def recipe_consume(
    recipe_id: int,
    actor: CurrentActor,
    recipes: RecipesSvc,
) -> Response:
    await recipes.consume(actor, recipe_id)
    return Response(status_code=204)


@router.post("/api/recipes/{recipe_id}/add-not-fulfilled-products-to-shoppinglist", status_code=204)
async def recipe_add_missing(
    recipe_id: int,
    request: Request,
    _actor: CurrentActor,
    recipes: RecipesSvc,
) -> Response:
    values = body_array(await request_body(request))
    excluded = values.get("excludedProductIds")
    if excluded is not None and not isinstance(excluded, (dict, list)):
        if excluded:
            raise php_error(
                "in_array(): Argument #2 ($haystack) must be of type array, string given"
            )
        excluded = None
    if isinstance(excluded, dict):
        excluded = list(excluded.values())
    await recipes.add_missing_to_shopping_list(recipe_id, excluded_product_ids=excluded)
    return Response(status_code=204)


@router.post("/api/recipes/{recipe_id}/copy")
async def recipe_copy(recipe_id: int, _actor: CurrentActor, recipes: RecipesSvc) -> dict[str, Any]:
    copy = await recipes.copy(recipe_id)
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
