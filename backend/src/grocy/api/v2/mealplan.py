from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.mealplan import MealPlanEntry
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.stock.service import StockService
from grocy.domains.units.service import UnitsService

router = APIRouter(tags=["meal plan"])


class MealShoppingBody(BaseModel):
    shopping_list_id: int = Field(default=1, gt=0)


@router.post("/meal-plan/{entry_id}/consume")
async def consume_meal(entry_id: int, actor: CurrentActor, session: DbSession) -> dict:
    entry = await session.get(MealPlanEntry, entry_id)
    if entry is None:
        raise NotFoundError("Meal plan entry not found")
    if entry.done:
        raise GrocyError("Meal is already completed", code="invalid_state")
    actor.require("STOCK_CONSUME")
    if entry.type == "recipe" and entry.recipe_id:
        result = await RecipesService(session).consume(
            actor, entry.recipe_id, servings=entry.recipe_servings, commit=False
        )
    elif entry.type == "product" and entry.product_id:
        product = await ProductsService(session).get(entry.product_id)
        amount = await UnitsService(session).convert(
            Decimal(entry.product_amount or 1),
            entry.product_qu_id or product.qu_id_stock,
            product.qu_id_stock,
            product_id=product.id,
        )
        result = await StockService(session).consume(actor, product.id, amount, commit=False)
    else:
        result = {"bookings": []}
    entry.done = 1
    await session.commit()
    return {"entry_id": entry.id, "done": True, "result": result}


@router.post("/meal-plan/{entry_id}/shopping-list")
async def meal_shopping(
    entry_id: int, body: MealShoppingBody, actor: CurrentActor, session: DbSession
) -> dict:
    actor.require("SHOPPINGLIST_ITEMS_ADD")
    entry = await session.get(MealPlanEntry, entry_id)
    if entry is None:
        raise NotFoundError("Meal plan entry not found")
    if entry.type != "recipe" or not entry.recipe_id:
        raise GrocyError("This meal has no recipe")
    return await RecipesService(session).add_missing_to_shopping_list(
        entry.recipe_id, servings=entry.recipe_servings, shopping_list_id=body.shopping_list_id
    )
