from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Date, DateTime, Integer, Numeric, select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.catalog import Location, Product, ProductBarcode, ProductGroup, QuantityUnit
from grocy.db.models.household import Battery, Chore, Task, TaskCategory
from grocy.db.models.mealplan import MealPlanEntry, MealPlanSection
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
from grocy.db.models.shopping import ShoppingList, ShoppingListItem
from grocy.db.models.stock import StockEntry, StockLog
from grocy.db.models.units import QuantityUnitConversion
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.units.service import UnitsService

READ_ONLY_ENTITIES = {"stock_log"}

ENTITY_MODELS: dict[str, type] = {
    "products": Product,
    "locations": Location,
    "quantity_units": QuantityUnit,
    "quantity_unit_conversions": QuantityUnitConversion,
    "product_groups": ProductGroup,
    "product_barcodes": ProductBarcode,
    "shopping_lists": ShoppingList,
    "shopping_list": ShoppingListItem,
    "recipes": Recipe,
    "recipes_pos": RecipePosition,
    "recipes_nestings": RecipeNesting,
    "meal_plan": MealPlanEntry,
    "meal_plan_sections": MealPlanSection,
    "chores": Chore,
    "tasks": Task,
    "task_categories": TaskCategory,
    "batteries": Battery,
    "stock": StockEntry,
    "stock_log": StockLog,
}


class GenericObjectsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.products = ProductsService(session)
        self.units = UnitsService(session)
        self.recipes = RecipesService(session)

    def supported_entities(self) -> list[str]:
        return sorted(ENTITY_MODELS)

    def _require_writable(self, entity: str) -> type:
        if entity in READ_ONLY_ENTITIES:
            raise GrocyError(f"Entity '{entity}' is read-only", code="read_only")
        model = ENTITY_MODELS.get(entity)
        if model is None:
            raise NotFoundError(f"Entity '{entity}' is not implemented yet")
        return model

    async def list_entity(self, entity: str) -> list[dict[str, Any]]:
        if entity == "products":
            rows = await self.products.list_products()
            return [self.products.serialize(row) for row in rows]
        if entity == "quantity_units":
            rows = await self.units.list_units()
            return [self.units.serialize_unit(row) for row in rows]
        if entity == "quantity_unit_conversions":
            rows = await self.units.list_conversions()
            return [self.units.serialize_conversion(row) for row in rows]
        if entity == "recipes":
            rows = await self.recipes.list_recipes()
            return [self.recipes.serialize(row) for row in rows]
        model = ENTITY_MODELS.get(entity)
        if model is None:
            raise NotFoundError(f"Entity '{entity}' is not implemented yet")
        rows = (await self.session.execute(select(model).order_by(model.id))).scalars().all()
        return [self._serialize_row(entity, row) for row in rows]

    async def get_entity(self, entity: str, object_id: int) -> dict[str, Any]:
        if entity == "products":
            product = await self.products.get(object_id)
            return self.products.serialize(product)
        if entity == "recipes":
            recipe = await self.recipes.get(object_id)
            return self.recipes.serialize(recipe)
        model = ENTITY_MODELS.get(entity)
        if model is None:
            raise NotFoundError(f"Entity '{entity}' is not implemented yet")
        row = await self.session.get(model, object_id)
        if row is None:
            raise NotFoundError(f"{entity} {object_id} not found")
        return self._serialize_row(entity, row)

    async def create_entity(self, entity: str, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._require_writable(entity)
        row = model()
        self._apply_payload(row, payload)
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        data = self._serialize_row(entity, row)
        data["created_object_id"] = row.id
        return data

    async def update_entity(
        self,
        entity: str,
        object_id: int,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        model = self._require_writable(entity)
        row = await self.session.get(model, object_id)
        if row is None:
            raise NotFoundError(f"{entity} {object_id} not found")
        self._apply_payload(row, payload)
        await self.session.commit()
        await self.session.refresh(row)
        return self._serialize_row(entity, row)

    async def delete_entity(self, entity: str, object_id: int) -> None:
        model = self._require_writable(entity)
        row = await self.session.get(model, object_id)
        if row is None:
            raise NotFoundError(f"{entity} {object_id} not found")
        await self.session.delete(row)
        await self.session.commit()

    def _apply_payload(self, row: Any, payload: dict[str, Any]) -> None:
        columns = {column.name: column for column in row.__table__.columns}
        for key, raw in payload.items():
            if key == "id" or key not in columns:
                continue
            setattr(row, key, self._coerce_value(columns[key], raw))

    def _coerce_value(self, column: Any, value: Any) -> Any:
        if value is None:
            return None
        col_type = column.type
        if isinstance(col_type, Numeric):
            if isinstance(value, Decimal):
                return value
            if isinstance(value, (int, float)):
                return Decimal(str(value))
            if isinstance(value, str):
                try:
                    return Decimal(value)
                except InvalidOperation:
                    return value
        if isinstance(col_type, Integer):
            if isinstance(value, bool):
                return int(value)
            if isinstance(value, str) and value.lstrip("-").isdigit():
                return int(value)
            if isinstance(value, float) and value.is_integer():
                return int(value)
        if isinstance(col_type, Date):
            if isinstance(value, date):
                return value
            if isinstance(value, str):
                return date.fromisoformat(value[:10])
        if isinstance(col_type, DateTime):
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                text = value.replace("Z", "")
                if "+" in text:
                    text = text.split("+", 1)[0]
                return datetime.fromisoformat(text)
        return value

    def _serialize_row(self, entity: str, row: Any) -> dict[str, Any]:
        if entity == "quantity_units":
            return self.units.serialize_unit(row)
        if entity == "quantity_unit_conversions":
            return self.units.serialize_conversion(row)
        data: dict[str, Any] = {}
        for column in row.__table__.columns:
            value = getattr(row, column.name)
            if hasattr(value, "isoformat"):
                value = value.isoformat()
            elif hasattr(value, "as_tuple"):
                value = float(value)
            data[column.name] = value
        return data
