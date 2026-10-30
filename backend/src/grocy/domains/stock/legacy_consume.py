"""Consume stock with the release's selection and statement commit rules."""

import math
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.input import database_error
from grocy.compatibility.php import loose_equals, pdo_parameter, truthy
from grocy.core.actor import Actor
from grocy.core.errors import GrocyError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.db.native_schema import SCHEMA
from grocy.domains.users.service import UsersService


def _rounded(value: float) -> float:
    if not math.isfinite(value):
        return value
    return float(Decimal(repr(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class LegacyStockConsumption:
    def __init__(self, session: AsyncSession, *, autocommit: bool = True) -> None:
        self.session = session
        self.autocommit = autocommit

    async def _rows(self, sql: str, **parameters: Any) -> list[dict[str, Any]]:
        await configure_compatibility_queries(self.session)
        result = await self.session.execute(text(sql), parameters)
        return [dict(row) for row in result.mappings()]

    async def _write(self, sql: str, **parameters: Any) -> None:
        values = {}
        for key, value in parameters.items():
            parameter = pdo_parameter(int(value) if isinstance(value, bool) else value)
            values[key] = parameter.split("\x00", 1)[0] if parameter is not None else None
        try:
            await self.session.execute(text(sql), values)
            if self.autocommit:
                await self.session.commit()
                self.session.expire_all()
        except DBAPIError as error:
            if self.autocommit:
                await self.session.rollback()
            raise database_error(error) from error

    async def _insert(self, table: str, values: dict[str, Any]) -> None:
        columns = ",".join(values)
        bindings = ",".join(":" + key for key in values)
        await self._write(f"INSERT INTO {table} ({columns}) VALUES ({bindings})", **values)

    async def bookings(self, transaction_id: str) -> list[dict[str, Any]]:
        columns = ",".join(SCHEMA["tables"]["stock_log"])
        rows = await self._rows(
            f"SELECT {columns} FROM stock_log WHERE transaction_id=:id", id=transaction_id
        )
        if not rows:
            raise GrocyError("No transaction was found by the given transaction id", code=None)
        return rows

    async def consume(
        self,
        actor: Actor,
        product_id: int,
        amount: float,
        *,
        spoiled: bool = False,
        transaction_type: str = "consume",
        location_id: int | None = None,
        stock_entry_id: str | None = None,
        recipe_id: int | None = None,
        exact_amount: bool = False,
        allow_subproduct_substitution: bool = False,
        transaction_id: str | None = None,
    ) -> str:
        products = await self._rows(
            "SELECT * FROM products WHERE id=:id AND active=1", id=product_id
        )
        if not products:
            raise GrocyError("Product does not exist or is inactive", code=None)
        product = products[0]
        if amount <= 0:
            raise GrocyError("Amount can't be <= 0", code=None)
        if location_id is not None and not await self._rows(
            "SELECT id FROM locations WHERE id=:id AND active=1", id=location_id
        ):
            raise GrocyError("Location does not exist", code=None)
        current = await self._rows(
            "SELECT * FROM stock_current WHERE product_id=:id", id=product_id
        )
        own = float(current[0]["amount"]) if current else 0.0
        total = float(current[0]["amount_aggregated"]) if current else 0.0
        if product["enable_tare_weight_handling"] == 1:
            tare = float(product["tare_weight"])
            if exact_amount:
                amount = own + tare - amount
            if amount < tare:
                raise GrocyError(
                    "The amount cannot be lower than the defined tare weight", code=None
                )
            amount = abs(amount - own - tare)
        if transaction_type not in ("consume", "inventory-correction"):
            label = pdo_parameter(transaction_type) or ""
            raise GrocyError(
                f"Transaction type {label} is not valid (StockService.ConsumeProduct)",
                code=None,
            )
        condition = "product_id=:id"
        if allow_subproduct_substitution:
            condition = (
                "(product_id=:id OR product_id IN (SELECT sub_product_id "
                "FROM products_resolved WHERE parent_product_id=:id))"
            )
        entries = await self._rows(
            f"SELECT * FROM stock_next_use WHERE {condition} AND open IN (0,1)", id=product_id
        )
        entries = [
            row
            for row in entries
            if (location_id is None or loose_equals(row["location_id"], location_id))
            and (
                stock_entry_id in {None, "default"} or loose_equals(row["stock_id"], stock_entry_id)
            )
        ]
        if _rounded(amount) > _rounded(total):
            raise GrocyError(
                "Amount to be consumed cannot be > current stock amount "
                "(if supplied, at the desired location)",
                code=None,
            )
        transaction_id = transaction_id or uuid.uuid4().hex
        for row in entries:
            if amount == 0:
                break
            conversion = None
            if allow_subproduct_substitution and row["product_id"] != product_id:
                child = (
                    await self._rows("SELECT * FROM products WHERE id=:id", id=row["product_id"])
                )[0]
                factors = await self._rows(
                    "SELECT factor FROM cache__quantity_unit_conversions_resolved "
                    "WHERE product_id=:id AND from_qu_id=:source AND to_qu_id=:target LIMIT 1",
                    id=child["id"],
                    source=product["qu_id_stock"],
                    target=child["qu_id_stock"],
                )
                if factors:
                    conversion = float(factors[0]["factor"])
                    amount *= conversion
            available = float(row["amount"])
            take = min(amount, available)
            values = {
                key: row[key]
                for key in (
                    "product_id",
                    "best_before_date",
                    "purchased_date",
                    "stock_id",
                    "price",
                    "opened_date",
                    "location_id",
                    "note",
                )
            }
            values.update(
                amount=-take,
                used_date=date.today().isoformat(),
                spoiled=spoiled,
                transaction_type=transaction_type,
                recipe_id=recipe_id,
                transaction_id=transaction_id,
                user_id=actor.user_id,
            )
            await self._insert("stock_log", values)
            if amount >= available:
                await self._write("DELETE FROM stock WHERE id=:id", id=row["id"])
                amount -= available
                if conversion is not None:
                    amount /= conversion
            else:
                await self._write(
                    "UPDATE stock SET amount=:amount WHERE id=:id",
                    amount=available - amount,
                    id=row["id"],
                )
                amount = 0
        await self._auto_add_missing(actor.user_id)
        return transaction_id

    async def _auto_add_missing(self, user_id: int) -> None:
        settings = UsersService(self.session)
        if not truthy(
            await settings.setting(user_id, "shopping_list_auto_add_below_min_stock_amount")
        ):
            return
        list_id = await settings.setting(
            user_id, "shopping_list_auto_add_below_min_stock_amount_list_id"
        )
        if not await self._rows("SELECT id FROM shopping_lists WHERE id=:id", id=list_id):
            raise GrocyError("Shopping list does not exist", code=None)
        for missing in await self._rows("SELECT * FROM stock_missing_products"):
            product = (
                await self._rows(
                    "SELECT qu_id_purchase FROM products WHERE id=:id", id=missing["id"]
                )
            )[0]
            amount = float(_rounded(float(missing["amount_missing"])))
            existing = await self._rows(
                "SELECT id,amount FROM shopping_list WHERE product_id=:id LIMIT 1", id=missing["id"]
            )
            if existing:
                if existing[0]["amount"] < amount:
                    await self._write(
                        "UPDATE shopping_list SET amount=:amount,shopping_list_id=:list "
                        "WHERE id=:id",
                        amount=amount,
                        list=list_id,
                        id=existing[0]["id"],
                    )
            else:
                await self._insert(
                    "shopping_list",
                    {
                        "product_id": missing["id"],
                        "amount": amount,
                        "shopping_list_id": list_id,
                        "qu_id": product["qu_id_purchase"],
                    },
                )
