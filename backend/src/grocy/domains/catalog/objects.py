from __future__ import annotations

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.purifier import InputPurifier
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries
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
from grocy.db.native_schema import SCHEMA
from grocy.domains.catalog.views import VIEW_ENTITIES
from grocy.domains.recipes.service import RecipesService

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
        self.recipes = RecipesService(session)

    def supported_entities(self) -> list[str]:
        return sorted(set(ENTITY_MODELS) | VIEW_ENTITIES)

    def _require_writable(self, entity: str, *, deleting: bool = False) -> type:
        model = ENTITY_MODELS.get(entity)
        if model is None or entity in READ_ONLY_ENTITIES or (entity == "api_keys" and not deleting):
            message = "Invalid entity" if deleting else "Entity does not exist or is not exposed"
            raise GrocyError(message, code=None)
        return model

    def _require_readable(self, entity: str) -> None:
        if entity == "api_keys" or entity not in self.supported_entities():
            raise GrocyError("Entity does not exist or is not exposed", code=None)

    async def _read(self, entity: str, object_id: int | str | None = None) -> list[dict[str, Any]]:
        self._require_readable(entity)
        await configure_compatibility_queries(self.session)
        columns = SCHEMA["tables"].get(entity)
        projection = ",".join(f'"{name}"' for name in columns) if columns else "*"
        query = f'SELECT {projection} FROM "{entity}"'
        parameters = {}
        if object_id is not None:
            query += " WHERE id=:object_id LIMIT 1"
            parameters["object_id"] = str(object_id)
        result = await self.session.execute(text(query), parameters)
        return [dict(row) for row in result.mappings()]

    async def list_entity(self, entity: str) -> list[dict[str, Any]]:
        return await self._read(entity)

    async def get_entity(self, entity: str, object_id: int | str) -> dict[str, Any]:
        rows = await self._read(entity, object_id)
        if not rows:
            raise NotFoundError("Object not found", code=None)
        return rows[0]

    async def _write(
        self,
        entity: str,
        method: str,
        object_id: int | str | None,
        payload: dict[str, Any],
        runtime: InputPurifier,
    ) -> dict[str, Any]:
        self._require_writable(entity, deleting=method == "DELETE")
        result = await runtime.generic_write(
            entity=entity,
            method=method,
            object_id=object_id,
            body=payload,
            execute=NativeStatements(self.session).execute,
        )
        if "error_message" in result:
            raise GrocyError(result["error_message"], status_code=result["status"], code=None)
        if entity == "products" and method != "DELETE":
            await self.recipes.shopping.auto_add_missing()
            await self.session.commit()
        return result

    async def create_entity(
        self, entity: str, payload: dict[str, Any], runtime: InputPurifier
    ) -> dict[str, Any]:
        return await self._write(entity, "POST", None, payload, runtime)

    async def update_entity(
        self, entity: str, object_id: int | str, payload: dict[str, Any], runtime: InputPurifier
    ) -> dict[str, Any]:
        return await self._write(entity, "PUT", object_id, payload, runtime)

    async def delete_entity(
        self, entity: str, object_id: int | str, runtime: InputPurifier
    ) -> None:
        await self._write(entity, "DELETE", object_id, {}, runtime)

    async def write_userfields(
        self, entity: str, object_id: int | str, values: dict, *, commit_each: bool = False
    ) -> None:
        if not isinstance(values, dict):
            raise GrocyError("Userfields must be an object")
        definitions = {row.name or "": row for row in await self._userfield_definitions(entity)}
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

    async def _userfield_definitions(self, entity: str) -> list[UserfieldDefinition]:
        return list(
            (
                await self.session.scalars(
                    select(UserfieldDefinition)
                    .where(UserfieldDefinition.entity == entity)
                    .order_by(
                        UserfieldDefinition.sort_number,
                        UserfieldDefinition.name.collate("NOCASE"),
                    )
                )
            ).all()
        )

    async def userfield_data(
        self, entity: str, object_id: int | str | None = None
    ) -> tuple[list[str | None], list[dict[str, Any]]]:
        definitions = await self._userfield_definitions(entity)
        if not definitions:
            return [], []
        # The native resolved view aliases namespace values to userobjects.
        # Definitions still belong to the exact requested entity.
        condition = UserfieldDefinition.entity == entity
        if entity == "userobjects":
            condition |= UserfieldDefinition.entity.like("userentity-%")
        query = (
            select(
                UserfieldDefinition.name,
                UserfieldValue.object_id,
                UserfieldValue.value,
            )
            .join(UserfieldValue, UserfieldValue.field_id == UserfieldDefinition.id)
            .where(condition)
            .order_by(
                UserfieldDefinition.name.collate("NOCASE"),
                UserfieldDefinition.id,
                UserfieldValue.object_id,
                UserfieldValue.value,
            )
        )
        if object_id is not None:
            query = query.where(UserfieldValue.object_id == str(object_id))
        values = [dict(row) for row in (await self.session.execute(query)).mappings()]
        return [row.name for row in definitions], values
