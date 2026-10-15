from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Date, DateTime, Integer, Numeric, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.grocy_checks import GROCY_450_CHECKS
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
from grocy.db.models.users import ApiKey
from grocy.domains.catalog.effects import CatalogEffects
from grocy.domains.catalog.views import VIEW_ENTITIES, list_view
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.mealplan import sync_meal_plan_recipes
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
        self.effects = CatalogEffects(session)

    def supported_entities(self) -> list[str]:
        return sorted(set(ENTITY_MODELS) | VIEW_ENTITIES)

    def _require_writable(self, entity: str, *, deleting: bool = False) -> type:
        if entity in READ_ONLY_ENTITIES or (entity == "api_keys" and not deleting):
            raise GrocyError(f"Entity '{entity}' is read-only", code="read_only")
        model = ENTITY_MODELS.get(entity)
        if model is None:
            raise NotFoundError(f"Entity '{entity}' is not implemented yet")
        return model

    async def list_entity(self, entity: str) -> list[dict[str, Any]]:
        if entity == "api_keys":
            raise GrocyError("API keys cannot be read through generic objects", code="no_listing")
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
        if entity == "api_keys":
            raise GrocyError("API keys cannot be read through generic objects", code="no_listing")
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
        if not payload:
            # LessQL does not insert an empty row. Its fresh PDO reports lastInsertId 0.
            if entity == "products":
                await self.recipes.shopping.auto_add_missing()
                await self.session.commit()
            return {"created_object_id": 0}
        row = model()
        self._apply_payload(row, {k: v for k, v in payload.items() if k != "userfields"})
        await self._validate(row)
        if isinstance(row, Recipe):
            row.desired_servings = row.base_servings or Decimal("1")
        self.session.add(row)
        await self.session.flush()
        if isinstance(row, Product):
            await self.units.ensure_product_conversions(row)
        if isinstance(row, QuantityUnitConversion):
            await self.units.sync_inverse(row)
        if isinstance(row, Product) and row.cumulate_min_stock_amount_of_sub_products:
            await self.session.execute(
                update(Product)
                .where(Product.parent_product_id == row.id)
                .values(min_stock_amount=0)
            )
        if isinstance(row, MealPlanEntry):
            await sync_meal_plan_recipes(self.session, row.day)
        await self.write_userfields(entity, row.id, payload.get("userfields", {}))
        if isinstance(row, Product):
            await self.recipes.shopping.auto_add_missing()
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
            raise GrocyError("Object not found")
        old_unit = row.qu_id_stock if isinstance(row, Product) else None
        old_day = row.day if isinstance(row, MealPlanEntry) else None
        old_conversion = (
            (row.from_qu_id, row.to_qu_id, row.product_id)
            if isinstance(row, QuantityUnitConversion)
            else None
        )
        with self.session.no_autoflush:
            self._apply_payload(row, {k: v for k, v in payload.items() if k != "userfields"})
            await self._validate(row)
            if isinstance(row, Product) and old_unit is not None:
                await self.effects.change_stock_unit(row, old_unit)
        await self.session.flush()
        if isinstance(row, QuantityUnitConversion):
            await self.units.sync_inverse(row, previous=old_conversion)
        if isinstance(row, Product) and row.cumulate_min_stock_amount_of_sub_products:
            await self.session.execute(
                update(Product)
                .where(Product.parent_product_id == row.id)
                .values(min_stock_amount=0)
            )
        if isinstance(row, MealPlanEntry) and old_day is not None:
            await sync_meal_plan_recipes(self.session, old_day, row.day)
        await self.write_userfields(entity, row.id, payload.get("userfields", {}))
        if isinstance(row, Product):
            await self.recipes.shopping.auto_add_missing()
        await self.session.commit()
        await self.session.refresh(row)
        return self._serialize_row(entity, row)

    async def delete_entity(self, entity: str, object_id: int) -> None:
        model = self._require_writable(entity, deleting=True)
        row = await self.session.get(model, object_id)
        if row is None:
            raise GrocyError("Object not found")
        await self.effects.delete(entity, row)
        await self.session.commit()

    async def write_userfields(
        self, entity: str, object_id: int | str, values: dict, *, commit_each: bool = False
    ) -> None:
        if not isinstance(values, dict):
            raise GrocyError("Userfields must be an object")
        definitions = {
            row.name or "": row for row in await self._userfield_definitions(entity, object_id)
        }
        for name, value in values.items():
            if name not in definitions:
                raise GrocyError(
                    f"Field {name} is not a valid userfield of the given entity", code=None
                )
            if isinstance(value, (list, dict)):
                raise GrocyError("Custom field values must be scalar values")
            stored = (
                "" if value is None else str(int(value)) if isinstance(value, bool) else str(value)
            )
            row = await self.session.scalar(
                select(UserfieldValue).where(
                    UserfieldValue.field_id == definitions[name].id,
                    UserfieldValue.object_id == str(object_id),
                )
            )
            if row is None:
                self.session.add(
                    UserfieldValue(
                        field_id=definitions[name].id, object_id=str(object_id), value=stored
                    )
                )
            else:
                row.value = stored
            if commit_each:
                await self.session.commit()

    async def validate_userfield_entity(self, entity: str) -> None:
        if entity == "users" or entity in self.supported_entities():
            return
        if (
            entity.startswith("userentity-")
            and await self.session.scalar(
                select(UserEntity.id).where(UserEntity.name == entity.removeprefix("userentity-"))
            )
            is not None
        ):
            return
        raise GrocyError("Entity does not exist or is not exposed", code=None)

    async def _userfield_definitions(
        self, entity: str, object_id: int | str
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

    async def userfields(self, entity: str, object_id: int | str) -> dict[str, str | None]:
        definitions = await self._userfield_definitions(entity, object_id)
        rows = (
            await self.session.scalars(
                select(UserfieldValue).where(
                    UserfieldValue.field_id.in_([row.id for row in definitions]),
                    UserfieldValue.object_id == str(object_id),
                )
            )
        ).all()
        values = {row.field_id: row.value for row in rows}
        return {row.name or "": values.get(row.id) for row in definitions}

    def _apply_payload(self, row: Any, payload: dict[str, Any]) -> None:
        columns = {column.name: column for column in row.__table__.columns}
        checked = {
            expression.split()[0] for expression in GROCY_450_CHECKS.get(row.__tablename__, ())
        }
        for key, raw in payload.items():
            if key == "id" or key.startswith("row_"):
                continue
            if key not in columns:
                raise GrocyError(f"Unknown field '{key}'", code="invalid_field")
            try:
                # SQLite applies integer affinity before its native CHECK expressions.
                value = raw if key in checked else self._coerce_value(columns[key], raw)
            except (ValueError, TypeError, InvalidOperation) as exc:
                raise GrocyError(f"Invalid value for '{key}'", code="invalid_field") from exc
            if value is None and not columns[key].nullable:
                raise GrocyError(f"'{key}' is required", code="invalid_field")
            setattr(row, key, value)

    async def _validate(self, row: Any) -> None:
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
            zero_allowed = field == "amount" and isinstance(row, (ShoppingListItem, RecipePosition))
            if value is not None and (
                not Decimal(str(value)).is_finite()
                or value < 0
                or (value == 0 and not zero_allowed)
            ):
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
        if isinstance(row, MealPlanEntry):
            if row.recipe_servings is None:
                row.recipe_servings = Decimal("1")
            if row.type == "product" and row.product_id and not row.product_qu_id:
                row.product_qu_id = (await self.products.get(row.product_id)).qu_id_stock
        if isinstance(row, Product):
            if not row.qu_id_consume:
                row.qu_id_consume = row.qu_id_stock
            if not row.qu_id_price:
                row.qu_id_price = row.qu_id_purchase
        if isinstance(row, Product) and row.parent_product_id:
            if row.id is not None:
                with self.session.no_autoflush:
                    child = await self.session.scalar(
                        select(Product.id).where(Product.parent_product_id == row.id).limit(1)
                    )
                if child is not None:
                    raise GrocyError(
                        "Only one product nesting level is supported", code="product_cycle"
                    )
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
            if isinstance(value, datetime):
                value = (
                    value.date().isoformat()
                    if column.name == "opened_date"
                    else value.isoformat(sep=" ", timespec="seconds")
                )
            elif hasattr(value, "isoformat"):
                value = value.isoformat()
            elif hasattr(value, "as_tuple"):
                value = float(value)
            data[column.name] = value
        return data
