from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.query import query_rows
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
from grocy.db.models.settings import UserEntity, UserfieldDefinition, UserObject
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

    async def _read(self, entity: str, object_id: int | str) -> list[dict[str, Any]]:
        self._require_readable(entity)
        await configure_compatibility_queries(self.session)
        columns = SCHEMA["tables"].get(entity)
        projection = ",".join(f'"{name}"' for name in columns) if columns else "*"
        result = await self.session.execute(
            text(f'SELECT {projection} FROM "{entity}" WHERE id=:object_id LIMIT 1'),
            {"object_id": str(object_id)},
        )
        return [dict(row) for row in result.mappings()]

    async def read_objects(
        self, entity: str, object_id: str | None = None, query_string: bytes = b""
    ) -> dict[str, Any] | list[dict[str, Any]]:
        if object_id is not None:
            row = await self.get_entity(entity, object_id)
            reference = row["stock_id"] if entity == "stock" else object_id
            values = await self.get_userfields(entity, reference)
            row["userfields"] = field_response(values) if values else None
            return row
        self._require_readable(entity)
        await configure_compatibility_queries(self.session)
        rows = await query_rows(self.session, entity, query_string, SCHEMA["tables"].get(entity))
        fields = await self._fields(entity)
        if fields and rows:
            result = await self.session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity=:entity ORDER BY name COLLATE NOCASE"
                ),
                {"entity": entity},
            )
            values: dict[str, dict[str, Any]] = {}
            for reference, name, value in result:
                values.setdefault(str(reference), {}).setdefault(name, value)
            for row in rows:
                reference = row["stock_id"] if entity == "stock" else row["id"]
                saved = values.get(str(reference), {})
                row["userfields"] = field_response({name: saved.get(name) for _, name in fields})
        return rows

    async def get_entity(self, entity: str, object_id: int | str) -> dict[str, Any]:
        rows = await self._read(entity, object_id)
        if not rows:
            raise NotFoundError("Object not found", code=None)
        return rows[0]

    def _payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        values = {}
        for name, value in payload.items():
            if isinstance(value, (dict, list)):
                raise GrocyError(f"Invalid value for field {name}", code=None)
            if isinstance(value, int) and not -(2**63) <= value < 2**63:
                value = float(value)
            values[name] = value
        return values

    async def _after_write(self, entity: str) -> None:
        if entity == "products":
            await self.recipes.shopping.auto_add_missing()
        await self.session.commit()
        self.session.expire_all()

    async def create_entity(self, entity: str, payload: dict[str, Any]) -> dict[str, str]:
        self._require_writable(entity)
        payload = self._payload(payload)
        if payload:
            columns = ",".join(_identifier(name) for name in payload)
            bindings = ",".join("?" for _ in payload)
            statement = f'INSERT INTO "{entity}" ({columns}) VALUES ({bindings})'
        else:
            statement = f'INSERT INTO "{entity}" DEFAULT VALUES'
        connection = await self.session.connection()
        result = await connection.exec_driver_sql(statement, tuple(payload.values()))
        object_id = str(result.lastrowid)
        await self._after_write(entity)
        return {"created_object_id": object_id}

    async def update_entity(
        self, entity: str, object_id: int | str, payload: dict[str, Any]
    ) -> None:
        self._require_writable(entity)
        if not await self._read(entity, object_id):
            raise GrocyError("Object not found", code=None)
        payload = self._payload(payload)
        if payload:
            assignments = ",".join(f"{_identifier(name)}=?" for name in payload)
            connection = await self.session.connection()
            await connection.exec_driver_sql(
                f'UPDATE "{entity}" SET {assignments} WHERE id=?',
                (*payload.values(), str(object_id)),
            )
        await self._after_write(entity)

    async def delete_entity(self, entity: str, object_id: int | str) -> None:
        self._require_writable(entity, deleting=True)
        row = (
            await self.session.execute(
                text(f'SELECT id FROM "{entity}" WHERE id=:object_id'),
                {"object_id": str(object_id)},
            )
        ).first()
        if row is None:
            raise GrocyError("Object not found", code=None)
        if entity == "products":
            for table in ("nutrition_proposals", "nutrition_revisions"):
                await self.session.execute(
                    text(f'DELETE FROM "{table}" WHERE product_id=:id'), {"id": row.id}
                )
            await self.session.execute(
                text(
                    "DELETE FROM nutrition_evidence WHERE nutrition_id IN "
                    "(SELECT id FROM product_nutrition WHERE product_id=:id)"
                ),
                {"id": row.id},
            )
            await self.session.execute(
                text("DELETE FROM product_nutrition WHERE product_id=:id"), {"id": row.id}
            )
        await self.session.execute(
            text(f'DELETE FROM "{entity}" WHERE id=:object_id'), {"object_id": str(object_id)}
        )
        await self.session.commit()
        self.session.expire_all()

    async def _fields(self, entity: str) -> list[tuple[int, str]]:
        valid = entity in self.supported_entities() or entity == "users"
        if not valid and entity.startswith("userentity-"):
            valid = bool(
                await self.session.scalar(
                    text("SELECT 1 FROM userentities WHERE name=:name"),
                    {"name": entity.removeprefix("userentity-")},
                )
            )
        if not valid:
            raise GrocyError("Entity does not exist or is not exposed", code=None)
        result = await self.session.execute(
            text(
                "SELECT id,name FROM userfields WHERE entity=:entity "
                "ORDER BY sort_number,name COLLATE NOCASE"
            ),
            {"entity": entity},
        )
        return [(row.id, row.name) for row in result]

    async def write_userfields(
        self, entity: str, object_id: int | str, values: dict[str, Any]
    ) -> None:
        fields = {name: field_id for field_id, name in await self._fields(entity)}
        for name, value in values.items():
            if name not in fields:
                raise GrocyError(
                    f"Field {name} is not a valid userfield of the given entity", code=None
                )
            if isinstance(value, (dict, list)):
                raise GrocyError(f"Invalid value for field {name}", code=None)
        for name, value in values.items():
            parameters = {
                "field_id": fields[name],
                "object_id": str(object_id),
                "value": "" if value is None else value,
            }
            existing = await self.session.scalar(
                text(
                    "SELECT id FROM userfield_values WHERE field_id=:field_id "
                    "AND object_id=:object_id"
                ),
                parameters,
            )
            if existing is None:
                await self.session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "VALUES (:field_id,:object_id,:value)"
                    ),
                    parameters,
                )
            else:
                await self.session.execute(
                    text("UPDATE userfield_values SET value=:value WHERE id=:id"),
                    {"value": parameters["value"], "id": existing},
                )
        await self.session.commit()

    async def get_userfields(self, entity: str, object_id: int | str) -> dict[str, Any]:
        fields = await self._fields(entity)
        result = await self.session.execute(
            text(
                "SELECT name,value FROM userfield_values_resolved "
                "WHERE entity=:entity AND object_id=:object_id ORDER BY name COLLATE NOCASE"
            ),
            {"entity": entity, "object_id": str(object_id)},
        )
        values = {}
        for name, value in result:
            values.setdefault(name, value)
        return {name: values.get(name) for _, name in fields}


def _identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def field_response(values: dict[str, Any]) -> dict[str, Any] | list[Any]:
    if list(values) == [str(index) for index in range(len(values))]:
        return list(values.values())
    return values
