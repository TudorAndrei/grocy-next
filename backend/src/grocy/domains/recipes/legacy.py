"""Run the release recipe rules from its resolved SQLite records."""

import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.input import database_error
from grocy.compatibility.php import (
    empty,
    loose_equals,
    numeric_value,
    php_error,
    php_string,
    type_name,
)
from grocy.compatibility.rows import save_rows
from grocy.core.actor import Actor
from grocy.core.errors import GrocyError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.service import StockService


def _decimal(value: Any) -> Decimal:
    return Decimal(str(numeric_value(value)))


def _stock_error(error: GrocyError) -> GrocyError:
    message = error.message
    if error.code == "insufficient_stock":
        message = (
            "Amount to be consumed cannot be > current stock amount "
            "(if supplied, at the desired location)"
        )
    return GrocyError(message, status_code=error.status_code, code=None, details=error.details)


class LegacyRecipesService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.stock = StockService(session)

    async def _rows(self, statement: str, **parameters: Any) -> list[dict[str, Any]]:
        await configure_compatibility_queries(self.session)
        result = await self.session.execute(text(statement), parameters)
        return [dict(row) for row in result.mappings()]

    async def _recipe(self, recipe_id: str | int) -> dict[str, Any]:
        rows = await self._rows("SELECT * FROM recipes WHERE id=:id", id=recipe_id)
        if not rows:
            raise GrocyError("Recipe does not exist", code=None)
        return rows[0]

    async def _write(self, statement: str, *, caught: bool = True, **parameters: Any) -> str:
        try:
            connection = await self.session.connection()
            result = await connection.execute(text(statement), parameters)
            await self.session.commit()
            self.session.expire_all()
            return str(result.lastrowid)
        except DBAPIError as error:
            await self.session.rollback()
            if not caught:
                raise php_error(database_error(error).message) from error
            raise database_error(error) from error

    async def copy(self, recipe_id: str, name_format: str = "Copy of %s") -> str:
        recipe = await self._recipe(recipe_id)
        identity = await self._write(
            "INSERT INTO recipes (name,description,picture_file_name,base_servings,"
            "desired_servings,not_check_shoppinglist,type,product_id) "
            "SELECT :name,description,picture_file_name,base_servings,"
            "desired_servings,not_check_shoppinglist,type,product_id FROM recipes WHERE id=:id",
            name=name_format.replace("%s", php_string(recipe["name"]), 1),
            id=recipe_id,
        )
        await self._write(
            "INSERT INTO recipes_pos (recipe_id,product_id,amount,note,qu_id,"
            "only_check_single_unit_in_stock,ingredient_group,not_check_stock_fulfillment,"
            "variable_amount,price_factor) SELECT :copy,product_id,amount,note,qu_id,"
            "only_check_single_unit_in_stock,ingredient_group,not_check_stock_fulfillment,"
            "variable_amount,price_factor FROM recipes_pos WHERE recipe_id=:id",
            copy=identity,
            id=recipe_id,
        )
        await self._write(
            "INSERT INTO recipes_nestings (recipe_id,includes_recipe_id,servings) "
            "SELECT :copy,includes_recipe_id,servings FROM recipes_nestings WHERE recipe_id=:id",
            copy=identity,
            id=recipe_id,
        )
        return identity

    async def consume(self, actor: Actor, recipe_id: str) -> None:
        recipe = await self._recipe(recipe_id)
        positions = await self._rows(
            "SELECT * FROM recipes_pos_resolved WHERE recipe_id=:id", id=recipe_id
        )
        transaction = uuid.uuid4().hex
        await self.session.commit()
        try:
            for position in positions:
                stock = _decimal(position["stock_amount"])
                if not loose_equals(position["only_check_single_unit_in_stock"], 0) or stock <= 0:
                    continue
                await self.stock.consume(
                    actor,
                    position["product_id"],
                    min(stock, _decimal(position["recipe_amount"])),
                    commit=False,
                    allow_subproduct_substitution=True,
                    recipe_id=recipe["id"],
                    exact_amount=True,
                    transaction_id=transaction,
                )
            await self.session.commit()
        except DBAPIError as error:
            await self.session.rollback()
            raise database_error(error) from error
        except GrocyError as error:
            await self.session.rollback()
            raise _stock_error(error) from error
        source = recipe
        amount = recipe["desired_servings"]
        if recipe["type"] == "mealplan-shadow":
            meal = (
                await self._rows(
                    "SELECT * FROM meal_plan WHERE id=:id", id=recipe["name"].split("#")[1]
                )
            )[0]
            source = await self._recipe(meal["recipe_id"])
            amount = meal["recipe_servings"]
        if empty(source["product_id"]):
            return
        products = await self._rows("SELECT * FROM products WHERE id=:id", id=source["product_id"])
        resolved = await self._rows(
            "SELECT * FROM recipes_resolved WHERE recipe_id=:id", id=recipe_id
        )
        try:
            await self.stock.purchase(
                actor,
                source["product_id"],
                _decimal(amount),
                price=_decimal(resolved[0]["costs_per_serving"]),
                transaction_type="self-production",
                exact_amount=True,
                note=source["name"],
                stock_label_type=products[0]["default_stock_label_type"] if products else 0,
            )
        except GrocyError as error:
            raise _stock_error(error) from error
        except DBAPIError as error:
            await self.session.rollback()
            raise database_error(error) from error

    async def add_missing(self, recipe_id: str, excluded: Any) -> None:
        recipe_rows = await self._rows("SELECT * FROM recipes WHERE id=:id", id=recipe_id)
        positions = await self._rows(
            "SELECT * FROM recipes_pos_resolved WHERE recipe_id=:id", id=recipe_id
        )
        if not positions:
            return
        if loose_equals(excluded, None):
            excluded = []
        if not isinstance(excluded, (dict, list)):
            raise php_error(
                "in_array(): Argument #2 ($haystack) must be of type array, "
                + type_name(excluded)
                + " given"
            )
        excluded = list(excluded.values()) if isinstance(excluded, dict) else excluded
        recipe = recipe_rows[0]
        for position in positions:
            if any(loose_equals(position["product_id"], value) for value in excluded):
                continue
            product = (
                await self._rows("SELECT * FROM products WHERE id=:id", id=position["product_id"])
            )[0]
            missing = _decimal(position["missing_amount"])
            order = missing
            if not loose_equals(recipe["not_check_shoppinglist"], 1):
                order -= _decimal(position["amount_on_shopping_list"])
            order = order.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            unit = product["qu_id_purchase"]
            if loose_equals(position["only_check_single_unit_in_stock"], 1):
                conversions = await self._rows(
                    "SELECT factor FROM cache__quantity_unit_conversions_resolved "
                    "WHERE product_id=:product AND from_qu_id=:source AND to_qu_id=:target",
                    product=product["id"],
                    source=position["qu_id"],
                    target=product["qu_id_stock"],
                )
                if conversions:
                    order *= _decimal(conversions[0]["factor"])
                else:
                    unit, order = position["qu_id"], missing
            if order <= 0:
                continue
            existing = await self._rows(
                "SELECT id,amount FROM shopping_list WHERE product_id=:id LIMIT 1", id=product["id"]
            )
            if existing:
                await self._write(
                    "UPDATE shopping_list SET amount=:amount WHERE id=:id",
                    caught=False,
                    id=existing[0]["id"],
                    amount=str(_decimal(existing[0]["amount"]) + order),
                )
            else:
                try:
                    await save_rows(
                        self.session,
                        "shopping_list",
                        {"product_id": product["id"], "amount": str(order), "qu_id": unit},
                    )
                except DBAPIError as error:
                    await self.session.rollback()
                    raise php_error(database_error(error).message) from error
