from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.auth import get_db_session
from grocy.domains.calendar.service import CalendarService
from grocy.domains.household.service import HouseholdService
from grocy.domains.nutrition.service import NutritionService
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.shopping.service import ShoppingService
from grocy.domains.stock.service import StockService
from grocy.domains.units.service import UnitsService

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def get_products_service(session: DbSession) -> ProductsService:
    return ProductsService(session)


def get_stock_service(session: DbSession) -> StockService:
    return StockService(session)


def get_shopping_service(session: DbSession) -> ShoppingService:
    return ShoppingService(session)


def get_nutrition_service(session: DbSession) -> NutritionService:
    return NutritionService(session)


def get_units_service(session: DbSession) -> UnitsService:
    return UnitsService(session)


def get_recipes_service(session: DbSession) -> RecipesService:
    return RecipesService(session)


def get_household_service(session: DbSession) -> HouseholdService:
    return HouseholdService(session)


def get_calendar_service(session: DbSession) -> CalendarService:
    return CalendarService(session)


ProductsSvc = Annotated[ProductsService, Depends(get_products_service)]
StockSvc = Annotated[StockService, Depends(get_stock_service)]
ShoppingSvc = Annotated[ShoppingService, Depends(get_shopping_service)]
NutritionSvc = Annotated[NutritionService, Depends(get_nutrition_service)]
UnitsSvc = Annotated[UnitsService, Depends(get_units_service)]
RecipesSvc = Annotated[RecipesService, Depends(get_recipes_service)]
HouseholdSvc = Annotated[HouseholdService, Depends(get_household_service)]
CalendarSvc = Annotated[CalendarService, Depends(get_calendar_service)]
