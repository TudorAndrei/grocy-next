from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Date, DateTime, Integer, Numeric, select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.catalog import (
    Location,
    Product,
    ProductBarcode,
    ProductGroup,
    QuantityUnit,
    ShoppingLocation,
)
from grocy.db.models.equipment import Equipment
from grocy.db.models.household import (
    Battery,
    BatteryChargeCycle,
    Chore,
    ChoreLog,
    Task,
    TaskCategory,
)
from grocy.db.models.mealplan import MealPlanEntry, MealPlanSection
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
from grocy.db.models.settings import UserEntity, UserfieldDefinition, UserfieldValue, UserObject
from grocy.db.models.shopping import ShoppingList, ShoppingListItem
from grocy.db.models.stock import StockEntry, StockLog
from grocy.db.models.units import QuantityUnitConversion
from grocy.db.models.users import ApiKey, User
from grocy.domains.catalog.views import VIEW_ENTITIES, list_view
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.units.service import UnitsService

READ_ONLY_ENTITIES = VIEW_ENTITIES | {"stock_log", "stock", "chores_log", "battery_charge_cycles"}

ENTITY_MODELS: dict[str, type] = {
    "products": Product,
    "shopping_locations": ShoppingLocation,
    "userfields": UserfieldDefinition,
    "userentities": UserEntity,
    "userobjects": UserObject,
    "api_keys": ApiKey,
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
    "equipment": Equipment,
    "chores_log": ChoreLog,
    "battery_charge_cycles": BatteryChargeCycle,
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
        return sorted(set(ENTITY_MODELS) | VIEW_ENTITIES)

    def _require_writable(self, entity: str) -> type:
        if entity in READ_ONLY_ENTITIES:
            raise GrocyError(f"Entity '{entity}' is read-only", code="read_only")
        model = ENTITY_MODELS.get(entity)
        if model is None:
            raise NotFoundError(f"Entity '{entity}' is not implemented yet")
        return model

    async def list_entity(self, entity: str) -> list[dict[str, Any]]:
        if entity in VIEW_ENTITIES:
            return await list_view(self.session, entity)
        if entity == "products":
            rows = await self.products.list_products(include_inactive=True)
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
        if entity in VIEW_ENTITIES:
            row = next(
                (row for row in await list_view(self.session, entity) if row["id"] == object_id),
                None,
            )
            if row is None:
                raise NotFoundError(f"{entity} {object_id} not found")
            return row
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
        self._apply_payload(row, {k: v for k, v in payload.items() if k != "userfields"})
        await self._validate(row)
        if isinstance(row, Recipe):
            row.desired_servings = row.base_servings or Decimal("1")
        self.session.add(row)
        await self.session.flush()
        if isinstance(row, Product):
            await self.units.ensure_product_conversions(row)
        await self.write_userfields(entity, row.id, payload.get("userfields", {}))
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
        self._apply_payload(row, {k: v for k, v in payload.items() if k != "userfields"})
        await self._validate(row)
        await self.write_userfields(entity, row.id, payload.get("userfields", {}))
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

    async def write_userfields(self, entity: str, object_id: int, values: dict) -> None:
        if not isinstance(values, dict):
            raise GrocyError("Userfields must be an object")
        definitions = {
            row.name: row for row in await self._userfield_definitions(entity, object_id)
        }
        for name, value in values.items():
            if name not in definitions:
                raise GrocyError(f"Field '{name}' is not defined for this record")
            if isinstance(value, (list, dict)):
                raise GrocyError("Custom field values must be scalar values")
        for name, value in values.items():
            field_entity = definitions[name].entity
            stored = (
                None
                if value is None
                else str(int(value))
                if isinstance(value, bool)
                else str(value)
            )
            row = await self.session.scalar(
                select(UserfieldValue).where(
                    UserfieldValue.entity == field_entity,
                    UserfieldValue.object_id == object_id,
                    UserfieldValue.name == name,
                )
            )
            if row is None:
                self.session.add(
                    UserfieldValue(
                        entity=field_entity,
                        object_id=object_id,
                        name=name,
                        value=stored,
                    )
                )
            else:
                row.value = stored

    async def validate_userfield_object(self, entity: str, object_id: int) -> None:
        if entity.startswith("userentity-"):
            definition = await self.session.scalar(
                select(UserEntity).where(UserEntity.name == entity.removeprefix("userentity-"))
            )
            row = await self.session.get(UserObject, object_id)
            if definition is None or row is None or row.userentity_id != definition.id:
                raise NotFoundError("Custom record not found")
        elif entity == "users":
            if await self.session.get(User, object_id) is None:
                raise NotFoundError("User not found")
        else:
            await self.get_entity(entity, object_id)

    async def _userfield_definitions(
        self, entity: str, object_id: int
    ) -> list[UserfieldDefinition]:
        entities = [entity]
        if entity == "userobjects":
            row = await self.session.get(UserObject, object_id)
            definition = await self.session.get(UserEntity, row.userentity_id) if row else None
            if definition:
                entities.append(f"userentity-{definition.name}")
        return list(
            (
                await self.session.scalars(
                    select(UserfieldDefinition)
                    .where(UserfieldDefinition.entity.in_(entities))
                    .order_by(UserfieldDefinition.sort_number, UserfieldDefinition.name)
                )
            ).all()
        )

    async def userfields(self, entity: str, object_id: int) -> dict[str, str | None]:
        definitions = await self._userfield_definitions(entity, object_id)
        rows = (
            (
                await self.session.execute(
                    select(UserfieldValue).where(
                        UserfieldValue.entity.in_({row.entity for row in definitions}),
                        UserfieldValue.object_id == object_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        values = {(row.entity, row.name): row.value for row in rows}
        return {row.name: values.get((row.entity, row.name)) for row in definitions}

    def _apply_payload(self, row: Any, payload: dict[str, Any]) -> None:
        columns = {column.name: column for column in row.__table__.columns}
        for key, raw in payload.items():
            if key == "id" or key.startswith("row_"):
                continue
            if key not in columns:
                raise GrocyError(f"Unknown field '{key}'", code="invalid_field")
            try:
                value = self._coerce_value(columns[key], raw)
            except (ValueError, TypeError, InvalidOperation) as exc:
                raise GrocyError(f"Invalid value for '{key}'", code="invalid_field") from exc
            if value is None and not columns[key].nullable:
                raise GrocyError(f"'{key}' is required", code="invalid_field")
            setattr(row, key, value)

    async def _validate(self, row: Any) -> None:
        if hasattr(row, "name") and not str(row.name or "").strip():
            raise GrocyError("Name is required", code="invalid_field")
        for field in (
            "amount",
            "factor",
            "base_servings",
            "desired_servings",
            "qu_factor_purchase_to_stock",
            "recipe_servings",
            "product_amount",
        ):
            value = getattr(row, field, None)
            if value is not None and (not Decimal(str(value)).is_finite() or value <= 0):
                raise GrocyError(f"'{field}' must be positive", code="invalid_amount")
        if isinstance(row, Chore):
            if not row.start_date:
                row.start_date = datetime.now()
            if row.period_type not in {
                None,
                "manually",
                "hourly",
                "daily",
                "weekly",
                "monthly",
                "yearly",
                "adaptive",
            }:
                raise GrocyError("Invalid chore period")
            if row.period_interval is not None and row.period_interval <= 0:
                raise GrocyError("Repeat interval must be positive")
            if (
                row.period_type == "monthly"
                and row.period_days is not None
                and not 1 <= row.period_days <= 31
            ):
                raise GrocyError("Day of month must be between 1 and 31")
            if row.assignment_type not in {
                None,
                "no-assignment",
                "random",
                "who-least-did-first",
                "in-alphabetical-order",
            }:
                raise GrocyError("Invalid chore assignment")
            if row.consume_product_on_execution and not (row.product_id and row.product_amount):
                raise GrocyError("Chore stock consumption requires a product and amount")
        if (
            isinstance(row, Battery)
            and row.charge_interval_days is not None
            and row.charge_interval_days < 0
        ):
            raise GrocyError("Charge interval cannot be negative")
        if isinstance(row, Product):
            if not row.qu_id_consume:
                row.qu_id_consume = row.qu_id_stock
            if not row.qu_id_price:
                row.qu_id_price = row.qu_id_purchase
        if isinstance(row, Product) and row.parent_product_id:
            pending = row.parent_product_id
            seen = {row.id} if row.id else set()
            while pending:
                if pending in seen:
                    raise GrocyError("Product parent cycle", code="product_cycle")
                seen.add(pending)
                with self.session.no_autoflush:
                    parent = await self.session.get(Product, pending)
                pending = parent.parent_product_id if parent else None
        if isinstance(row, QuantityUnitConversion) and row.from_qu_id == row.to_qu_id:
            raise GrocyError("Quantity units must differ", code="invalid_conversion")
        if isinstance(row, RecipeNesting):
            if row.recipe_id == row.includes_recipe_id:
                raise GrocyError("Recipe nesting cycle", code="recipe_cycle")
            pending = [row.includes_recipe_id]
            seen: set[int] = set()
            while pending:
                current = pending.pop()
                if current == row.recipe_id:
                    raise GrocyError("Recipe nesting cycle", code="recipe_cycle")
                if current in seen:
                    continue
                seen.add(current)
                with self.session.no_autoflush:
                    children = (
                        (
                            await self.session.execute(
                                select(RecipeNesting).where(RecipeNesting.recipe_id == current)
                            )
                        )
                        .scalars()
                        .all()
                    )
                pending.extend(child.includes_recipe_id for child in children if child is not row)
        if isinstance(row, MealPlanEntry):
            kind = row.type or "recipe"
            if kind not in {"recipe", "product", "note"}:
                raise GrocyError("Meal type must be recipe, product, or note")
            if kind == "recipe" and not row.recipe_id:
                raise GrocyError("Recipe is required")
            if kind == "product" and not (row.product_id and row.product_amount):
                raise GrocyError("Product and amount are required")
            if kind == "note" and not row.note:
                raise GrocyError("Note is required")

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
                except InvalidOperation as exc:
                    raise ValueError("Invalid number") from exc
            raise ValueError("Invalid number")
        if isinstance(col_type, Integer):
            if isinstance(value, bool):
                return int(value)
            if isinstance(value, str) and value.lstrip("-").isdigit():
                return int(value)
            if isinstance(value, float) and value.is_integer():
                return int(value)
            if not isinstance(value, int):
                raise ValueError("Invalid integer")
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
