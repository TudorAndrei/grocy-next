from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.catalog import Location, Product
from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.models.nutrition import NutritionProposal, NutritionRevision, ProductNutrition
from grocy.db.models.recipes import RecipePosition
from grocy.db.models.shopping import ShoppingListItem
from grocy.db.models.stock import StockEntry, StockLog
from grocy.db.models.units import QuantityUnitConversion
from grocy.domains.products.service import ProductsService
from grocy.domains.stock.history import StockHistory


class StockService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.products = ProductsService(session)

    async def list_inventory(
        self,
        *,
        product_id: int | None = None,
        location_id: int | None = None,
        include_sub_products: bool = False,
    ) -> list[dict]:
        stmt = select(StockEntry)
        if product_id is not None:
            stmt = stmt.where(StockEntry.product_id == product_id)
        if location_id is not None:
            stmt = stmt.where(StockEntry.location_id == location_id)
        if product_id is not None:
            rows = await self._ordered_entries(product_id, location_id=location_id)
            if include_sub_products:
                for child_id in (await self.products.child_ids(product_id))[1:]:
                    rows.extend(await self._ordered_entries(child_id, location_id=location_id))
        else:
            rows = list((await self.session.execute(stmt.order_by(StockEntry.id))).scalars().all())
        return [self._serialize_entry(row) for row in rows]

    async def current_stock(self) -> list[dict]:
        products = await self.products.list_products()
        result: list[dict] = []
        for product in products:
            amount = await self.products.stock_amount(product.id)
            opened = await self._opened_amount(product.id)
            if amount <= 0 and opened <= 0:
                continue
            entries = await self.list_inventory(product_id=product.id)
            best_before = None
            dates = [e["best_before_date"] for e in entries if e["best_before_date"]]
            if dates:
                best_before = min(dates)
            result.append(
                {
                    "product_id": product.id,
                    "amount": float(amount),
                    "amount_aggregated": float(amount),
                    "amount_opened": float(opened),
                    "amount_opened_aggregated": float(opened),
                    "best_before_date": best_before,
                    "is_aggregated_amount": False,
                    "product": self.products.serialize(product),
                }
            )
        return result

    async def purchase(
        self,
        actor: Actor,
        product_id: int,
        amount: Decimal,
        *,
        best_before_date: date | None = None,
        purchased_date: date | None = None,
        price: Decimal | None = None,
        location_id: int | None = None,
        shopping_location_id: int | None = None,
        note: str | None = None,
        transaction_type: str = "purchase",
    ) -> dict:
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        if transaction_type not in {"purchase", "inventory-correction", "self-production"}:
            raise GrocyError("Invalid purchase transaction type")
        if product.enable_tare_weight_handling:
            amount -= await self.products.stock_amount(product_id) + product.tare_weight
            if amount <= 0:
                raise GrocyError("Gross amount must exceed stock plus tare weight")
        if best_before_date is None:
            days = product.default_best_before_days
            best_before_date = (
                date(2999, 12, 31) if days == -1 else date.today() + timedelta(days=days)
            )
        if price is not None and (not price.is_finite() or price < 0):
            raise GrocyError("Price must be non-negative")
        if not product.active or product.no_own_stock:
            raise GrocyError("Product cannot have its own stock")
        stock_id = uuid.uuid4().hex
        entry = StockEntry(
            product_id=product.id,
            amount=amount,
            best_before_date=best_before_date,
            purchased_date=purchased_date or date.today(),
            stock_id=stock_id,
            price=price,
            location_id=location_id or product.location_id,
            shopping_location_id=shopping_location_id or product.shopping_location_id,
            note=note,
        )
        self.session.add(entry)
        await self.session.flush()
        log = await self._add_log(
            actor=actor,
            product_id=product.id,
            amount=amount,
            transaction_type=transaction_type,
            stock_id=stock_id,
            best_before_date=best_before_date,
            purchased_date=purchased_date or date.today(),
            price=price,
            location_id=entry.location_id,
            stock_row_id=entry.id,
            shopping_location_id=entry.shopping_location_id,
            note=note,
        )
        await self.session.commit()
        return {
            "id": log.id,
            "product_id": product.id,
            "amount": float(amount),
            "stock_id": stock_id,
            "transaction_type": transaction_type,
            "transaction_id": log.transaction_id,
        }

    async def consume(
        self,
        actor: Actor,
        product_id: int,
        amount: Decimal,
        *,
        spoiled: bool = False,
        location_id: int | None = None,
        allow_subproduct_substitution: bool = False,
        commit: bool = True,
        stock_entry_id: str | None = None,
        recipe_id: int | None = None,
        exact_amount: bool = True,
        transaction_type: str = "consume",
    ) -> dict:
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        if transaction_type not in {"consume", "inventory-correction"}:
            raise GrocyError("Invalid consume transaction type")
        if product.enable_tare_weight_handling and not exact_amount:
            if amount < product.tare_weight:
                raise GrocyError("Gross amount cannot be below tare weight")
            amount = abs(
                amount - await self.products.stock_amount(product_id) - product.tare_weight
            )
        if amount <= 0:
            raise GrocyError("Amount to consume must be positive")
        remaining = amount
        entries = await self._ordered_entries(product_id, location_id=location_id)
        if stock_entry_id and stock_entry_id != "default":
            entries = [entry for entry in entries if entry.stock_id == stock_entry_id]
        if allow_subproduct_substitution:
            from grocy.domains.units.service import UnitsService

            ids = await self.products.child_ids(product_id)
            for child_id in ids:
                if child_id == product_id:
                    continue
                entries.extend(await self._ordered_entries(child_id, location_id=location_id))
            units = UnitsService(self.session)
            factors = {}
            for entry in entries:
                child = await self.products.get(entry.product_id)
                factors[entry.product_id] = await units.convert(
                    Decimal("1"), child.qu_id_stock, product.qu_id_stock, product_id=child.id
                )
        else:
            factors = {product_id: Decimal("1")}
        total = sum((entry.amount * factors[entry.product_id] for entry in entries), Decimal("0"))
        if total < amount:
            raise GrocyError(
                f"insufficient stock: have {total}, need {amount}",
                status_code=400,
                code="insufficient_stock",
            )
        transaction_id = uuid.uuid4().hex
        last_log_id = None
        for entry in entries:
            if remaining <= 0:
                break
            factor = factors[entry.product_id]
            take = min(entry.amount, remaining / factor)
            before = self._serialize_entry(entry)
            entry.amount -= take
            remaining -= take * factor
            log = await self._add_log(
                actor=actor,
                product_id=entry.product_id,
                amount=-take,
                transaction_type=transaction_type,
                stock_id=entry.stock_id,
                best_before_date=entry.best_before_date,
                purchased_date=entry.purchased_date,
                price=entry.price,
                undo_data=json.dumps({"before": before}),
                note=entry.note,
                recipe_id=recipe_id,
                used_date=date.today(),
                spoiled=1 if spoiled else 0,
                location_id=entry.location_id,
                stock_row_id=entry.id,
                transaction_id=transaction_id,
            )
            last_log_id = log.id
            if entry.amount == 0:
                await self.session.delete(entry)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()
        return {
            "id": last_log_id,
            "product_id": product_id,
            "amount": float(amount),
            "transaction_type": transaction_type,
            "transaction_id": transaction_id,
        }

    async def open(
        self,
        actor: Actor,
        product_id: int,
        amount: Decimal = Decimal("1"),
    ) -> dict:
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        if product.enable_tare_weight_handling:
            raise GrocyError("Cannot open a tare weight product")
        remaining = amount
        entries = await self._ordered_entries(product_id)
        closed = [e for e in entries if not e.open]
        available = sum((e.amount for e in closed), Decimal("0"))
        if available < amount:
            raise GrocyError(
                f"insufficient unopened stock: have {available}, need {amount}",
                code="insufficient_stock",
            )
        transaction_id = uuid.uuid4().hex
        last_log_id = None
        for entry in closed:
            if remaining <= 0:
                break
            before = self._serialize_entry(entry)
            take = min(entry.amount, remaining)
            open_location = (
                product.default_consume_location_id
                if product.move_on_open and product.default_consume_location_id
                else entry.location_id
            )
            expiry = entry.best_before_date
            if product.default_best_before_days_after_open > 0:
                opened_expiry = date.today() + timedelta(
                    days=product.default_best_before_days_after_open
                )
                expiry = min(expiry, opened_expiry) if expiry else opened_expiry
            if take < entry.amount:
                new_entry = StockEntry(
                    product_id=entry.product_id,
                    amount=take,
                    best_before_date=expiry,
                    purchased_date=entry.purchased_date,
                    stock_id=uuid.uuid4().hex,
                    price=entry.price,
                    open=1,
                    opened_date=datetime.now(),
                    location_id=open_location,
                )
                entry.amount -= take
                self.session.add(new_entry)
                await self.session.flush()
                stock_row_id = new_entry.id
                stock_id = new_entry.stock_id
            else:
                entry.location_id = open_location
                entry.best_before_date = expiry
                entry.open = 1
                entry.opened_date = datetime.now()
                stock_row_id = entry.id
                stock_id = entry.stock_id
            remaining -= take
            log = await self._add_log(
                actor=actor,
                product_id=product_id,
                amount=take,
                transaction_type="product-opened",
                stock_id=stock_id,
                location_id=entry.location_id,
                stock_row_id=stock_row_id,
                transaction_id=transaction_id,
                undo_data=json.dumps({"before": before}),
                best_before_date=before["best_before_date"]
                and date.fromisoformat(before["best_before_date"]),
                purchased_date=entry.purchased_date,
                price=entry.price,
            )
            last_log_id = log.id
        await self.session.commit()
        return {
            "id": last_log_id,
            "product_id": product_id,
            "amount": float(amount),
            "transaction_type": "product-opened",
            "transaction_id": transaction_id,
        }

    async def transfer(
        self,
        actor: Actor,
        product_id: int,
        amount: Decimal,
        location_id_from: int,
        location_id_to: int,
    ) -> dict:
        if location_id_from == location_id_to:
            raise GrocyError(
                "source and destination locations must differ",
                code="invalid_transfer",
            )
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        if product.enable_tare_weight_handling:
            raise GrocyError("Cannot transfer a tare weight product")
        for location_id in (location_id_from, location_id_to):
            if await self.session.get(Location, location_id) is None:
                raise NotFoundError("Location not found")
        remaining = amount
        entries = await self._ordered_entries(product_id, location_id=location_id_from)
        total = sum((e.amount for e in entries), Decimal("0"))
        if total < amount:
            raise GrocyError(
                f"insufficient stock at source: have {total}, need {amount}",
                code="insufficient_stock",
            )
        transaction_id = uuid.uuid4().hex
        last_log_id = None
        for entry in entries:
            if remaining <= 0:
                break
            take = min(entry.amount, remaining)
            before = self._serialize_entry(entry)
            entry.amount -= take
            remaining -= take
            dest = StockEntry(
                product_id=product_id,
                amount=take,
                best_before_date=entry.best_before_date,
                purchased_date=entry.purchased_date,
                stock_id=uuid.uuid4().hex,
                price=entry.price,
                open=entry.open,
                opened_date=entry.opened_date,
                location_id=location_id_to,
            )
            self.session.add(dest)
            await self.session.flush()
            log = await self._add_log(
                actor=actor,
                product_id=product_id,
                amount=take,
                transaction_type="transfer",
                stock_id=dest.stock_id,
                best_before_date=entry.best_before_date,
                purchased_date=entry.purchased_date,
                price=entry.price,
                location_id=location_id_to,
                stock_row_id=dest.id,
                transaction_id=transaction_id,
                undo_data=json.dumps({"before": before}),
            )
            last_log_id = log.id
            if entry.amount == 0:
                await self.session.delete(entry)
        await self.session.commit()
        return {
            "id": last_log_id,
            "product_id": product_id,
            "amount": float(amount),
            "transaction_type": "transfer",
            "transaction_id": transaction_id,
            "location_id_from": location_id_from,
            "location_id_to": location_id_to,
        }

    async def inventory(
        self,
        actor: Actor,
        product_id: int,
        new_amount: Decimal,
        *,
        best_before_date: date | None = None,
        location_id: int | None = None,
        price: Decimal | None = None,
        shopping_location_id: int | None = None,
        note: str | None = None,
    ) -> dict:
        if not new_amount.is_finite() or new_amount < 0:
            raise GrocyError("new amount must be non-negative", code="invalid_amount")
        product = await self.products.get(product_id)
        if product.enable_tare_weight_handling:
            new_amount -= product.tare_weight
            if new_amount < 0:
                raise GrocyError("Gross count cannot be below tare weight")
        if location_id is not None:
            entries = await self._ordered_entries(product_id, location_id=location_id)
            current = sum((e.amount for e in entries), Decimal("0"))
        else:
            current = await self.products.stock_amount(product_id)
        delta = new_amount - current
        if delta == 0:
            return {
                "id": None,
                "product_id": product_id,
                "amount": float(new_amount),
                "transaction_type": "inventory-correction",
                "delta": 0,
            }
        loc = location_id or product.location_id
        if delta > 0:
            if best_before_date is None:
                best_before_date = date.today() + timedelta(
                    days=max(0, product.default_best_before_days)
                )
            stock_id = uuid.uuid4().hex
            entry = StockEntry(
                product_id=product_id,
                amount=delta,
                best_before_date=best_before_date,
                purchased_date=date.today(),
                stock_id=stock_id,
                location_id=loc,
                price=price,
                shopping_location_id=shopping_location_id,
                note=note,
            )
            self.session.add(entry)
            await self.session.flush()
            log = await self._add_log(
                actor=actor,
                product_id=product_id,
                amount=delta,
                transaction_type="inventory-correction",
                stock_id=stock_id,
                best_before_date=best_before_date,
                purchased_date=date.today(),
                location_id=loc,
                stock_row_id=entry.id,
                price=price,
                shopping_location_id=shopping_location_id,
                note=note,
            )
            await self.session.commit()
            return {
                "id": log.id,
                "product_id": product_id,
                "amount": float(new_amount),
                "transaction_type": "inventory-correction",
                "transaction_id": log.transaction_id,
                "delta": float(delta),
            }

        remaining = abs(delta)
        entries = await self._ordered_entries(product_id, location_id=location_id)
        total = sum((entry.amount for entry in entries), Decimal("0"))
        if total < remaining:
            raise GrocyError(
                f"insufficient stock for inventory correction: have {total}",
                code="insufficient_stock",
            )
        transaction_id = uuid.uuid4().hex
        last_log_id = None
        for entry in entries:
            if remaining <= 0:
                break
            take = min(entry.amount, remaining)
            before = self._serialize_entry(entry)
            entry.amount -= take
            remaining -= take
            log = await self._add_log(
                actor=actor,
                product_id=product_id,
                amount=-take,
                transaction_type="inventory-correction",
                stock_id=entry.stock_id,
                best_before_date=entry.best_before_date,
                location_id=entry.location_id,
                stock_row_id=entry.id,
                transaction_id=transaction_id,
                purchased_date=entry.purchased_date,
                price=entry.price,
                undo_data=json.dumps({"before": before}),
            )
            last_log_id = log.id
            if entry.amount == 0:
                await self.session.delete(entry)
        await self.session.commit()
        return {
            "id": last_log_id,
            "product_id": product_id,
            "amount": float(new_amount),
            "transaction_type": "inventory-correction",
            "transaction_id": transaction_id,
            "delta": float(delta),
        }

    async def undo_booking(self, actor: Actor, booking_id: int) -> dict:
        log = await self.session.get(StockLog, booking_id)
        if log is None:
            raise NotFoundError(f"Booking {booking_id} not found")
        if log.undone:
            raise GrocyError("booking already undone", code="already_undone")
        related = (
            (
                await self.session.execute(
                    select(StockLog).where(
                        StockLog.transaction_id == log.transaction_id,
                        StockLog.undone == 0,
                    )
                )
            )
            .scalars()
            .all()
        )
        if not related:
            related = [log]
        for item in related:
            await self._undo_single(actor, item)
        await self.session.commit()
        return {
            "id": booking_id,
            "undone": True,
            "transaction_id": log.transaction_id,
            "transaction_type": log.transaction_type,
        }

    async def product_details(self, product_id: int) -> dict:
        from grocy.db.models.catalog import QuantityUnit

        product = await self.products.get(product_id)
        amount = await self.products.stock_amount(product_id)
        opened = await self._opened_amount(product_id)
        entries = await self._ordered_entries(product_id)
        logs = list(
            (
                await self.session.execute(
                    select(StockLog).where(StockLog.product_id == product_id).order_by(StockLog.id)
                )
            )
            .scalars()
            .all()
        )
        history = StockHistory(logs)
        last_purchase = history.last.log if history.last else None
        uses = [log for log in logs if log.transaction_type == "consume" and not log.undone]
        last_price = history.last_price
        average_price = history.average_price
        current_price = entries[0].price if entries and entries[0].price is not None else last_price
        dates = [e.best_before_date for e in entries if e.best_before_date]
        units = {}
        for key, unit_id in [
            ("quantity_unit_stock", product.qu_id_stock),
            ("default_quantity_unit_purchase", product.qu_id_purchase),
            ("default_quantity_unit_consume", product.qu_id_stock),
            ("quantity_unit_price", product.qu_id_stock),
        ]:
            unit = await self.session.get(QuantityUnit, unit_id)
            units[key] = (
                {"id": unit.id, "name": unit.name, "name_plural": unit.name_plural}
                if unit
                else None
            )
        location = await self.session.get(Location, product.location_id)
        loc = {"id": location.id, "name": location.name} if location else None
        serialized = self.products.serialize(product, stock_amount=amount)
        return {
            **serialized,
            "product": serialized,
            "product_barcodes": serialized["barcodes"],
            **units,
            "stock_amount_opened": float(opened),
            "stock_amount_aggregated": float(amount),
            "stock_value": float(
                sum(
                    (entry.amount * (entry.price or Decimal("0")) for entry in entries),
                    Decimal("0"),
                )
            ),
            "stock_amount_opened_aggregated": float(opened),
            "is_aggregated_amount": False,
            "last_purchased": last_purchase.purchased_date.isoformat()
            if last_purchase and last_purchase.purchased_date
            else None,
            "last_used": max((log.used_date for log in uses if log.used_date), default=None),
            "last_price": float(last_price) if last_price is not None else None,
            "avg_price": float(average_price) if average_price is not None else None,
            "current_price": float(current_price) if current_price is not None else None,
            "oldest_price": float(current_price) if current_price is not None else None,
            "last_shopping_location_id": last_purchase.shopping_location_id
            if last_purchase
            else None,
            "default_shopping_location_id": product.shopping_location_id,
            "next_due_date": min(dates).isoformat() if dates else None,
            "location": loc,
            "default_location": loc,
            "has_childs": len(await self.products.child_ids(product_id)) > 1,
            "qu_conversion_factor_purchase_to_stock": float(product.qu_factor_purchase_to_stock),
            "qu_conversion_factor_price_to_stock": 1,
            "average_shelf_life_days": history.average_shelf_life,
            "spoil_rate_percent": (
                100
                * sum(abs(log.amount) for log in uses if log.spoiled)
                / sum(abs(log.amount) for log in uses)
                if uses and sum(abs(log.amount) for log in uses)
                else 0
            ),
        }

    async def get_entry(self, entry_id: int) -> dict:
        entry = await self.session.get(StockEntry, entry_id)
        if entry is None:
            raise NotFoundError(f"Stock entry {entry_id} not found")
        return self._serialize_entry(entry)

    async def edit_entry(
        self, entry_id: int, *, actor: Actor | None = None, **fields: Any
    ) -> list[dict]:
        entry = await self.session.get(StockEntry, entry_id)
        if entry is None:
            raise NotFoundError(f"Stock entry {entry_id} not found")
        actor = actor or Actor(user_id=1, username="system")
        logs: list[dict] = []
        amount = fields.get("amount")
        if amount is not None:
            new_amount = Decimal(str(amount))
            if not new_amount.is_finite() or new_amount < 0:
                raise GrocyError("amount must be non-negative", code="invalid_amount")
            delta = new_amount - entry.amount
            if delta != 0:
                entry.amount = new_amount
                log = await self._add_log(
                    actor=actor,
                    product_id=entry.product_id,
                    amount=delta,
                    transaction_type="inventory-correction",
                    stock_id=entry.stock_id,
                    best_before_date=entry.best_before_date,
                    purchased_date=entry.purchased_date,
                    location_id=entry.location_id,
                    stock_row_id=entry.id,
                )
                logs.append(self._serialize_log(log))
        if "best_before_date" in fields:
            entry.best_before_date = fields["best_before_date"]
        if "purchased_date" in fields:
            entry.purchased_date = fields["purchased_date"]
        if fields.get("price") is not None:
            entry.price = Decimal(str(fields["price"]))
        if fields.get("location_id") is not None:
            entry.location_id = fields["location_id"]
        if fields.get("shopping_location_id") is not None:
            entry.shopping_location_id = fields["shopping_location_id"]
        if fields.get("open") is not None:
            entry.open = 1 if fields["open"] else 0
            if entry.open and entry.opened_date is None:
                entry.opened_date = datetime.now()
            if not entry.open:
                entry.opened_date = None
        if "note" in fields:
            entry.note = fields["note"]
        await self.session.commit()
        return logs

    async def volatile(self, due_soon_days: int = 5) -> dict:
        today = date.today()
        due_limit = today + timedelta(days=due_soon_days)
        due_products: list[dict] = []
        overdue_products: list[dict] = []
        expired_products: list[dict] = []
        missing_products: list[dict] = []

        products = await self.products.list_products()
        for product in products:
            amount = await self.products.stock_amount(product.id)
            opened = await self._opened_amount(product.id)
            entries = await self._ordered_entries(product.id)
            dates = [e.best_before_date for e in entries if e.best_before_date and e.amount > 0]
            best_before = min(dates) if dates else None

            usable_amount = amount - opened if product.treat_opened_as_out_of_stock else amount
            if usable_amount < product.min_stock_amount:
                missing = product.min_stock_amount - usable_amount
                missing_products.append(
                    {
                        "id": product.id,
                        "name": product.name,
                        "amount_missing": float(missing),
                        "is_partly_in_stock": 1 if amount > 0 else 0,
                    }
                )

            if amount <= 0 and opened <= 0:
                continue

            stock_row = self._stock_overview_row(product, amount, opened, best_before)
            if best_before is None:
                continue
            if best_before < today:
                overdue_products.append(stock_row)
                expired_products.append(stock_row)
            elif today <= best_before <= due_limit:
                due_products.append(stock_row)

        return {
            "due_products": due_products,
            "overdue_products": overdue_products,
            "expired_products": expired_products,
            "missing_products": missing_products,
        }

    async def product_locations(
        self, product_id: int, *, include_sub_products: bool = False
    ) -> list[dict]:
        await self.products.get(product_id)
        stmt = (
            select(
                StockEntry.location_id,
                Location.name,
                Location.is_freezer,
                StockEntry.amount,
                StockEntry.id,
            )
            .join(Location, Location.id == StockEntry.location_id, isouter=True)
            .where(
                StockEntry.product_id.in_(
                    await self.products.child_ids(product_id)
                    if include_sub_products
                    else [product_id]
                ),
                StockEntry.amount > 0,
            )
            .order_by(Location.name, StockEntry.id)
        )
        rows = (await self.session.execute(stmt)).all()
        aggregated: dict[int | None, dict] = {}
        for location_id, name, is_freezer, amount, _entry_id in rows:
            key = location_id
            if key not in aggregated:
                aggregated[key] = {
                    "id": 1,
                    "product_id": product_id,
                    "amount": Decimal("0"),
                    "location_id": location_id,
                    "location_name": name,
                    "location_is_freezer": is_freezer or 0,
                }
            aggregated[key]["amount"] += amount
        result = []
        for row in aggregated.values():
            payload = dict(row)
            payload["amount"] = float(payload["amount"])
            result.append(payload)
        return result

    async def price_history(self, product_id: int) -> list[dict]:
        from grocy.db.models.catalog import ShoppingLocation

        await self.products.get(product_id)
        logs = list(
            (
                await self.session.execute(
                    select(StockLog).where(StockLog.product_id == product_id).order_by(StockLog.id)
                )
            )
            .scalars()
            .all()
        )
        history = StockHistory(logs)
        result = []
        for purchase in history.priced:
            log = purchase.log
            store = (
                await self.session.get(ShoppingLocation, log.shopping_location_id)
                if log.shopping_location_id
                else None
            )
            result.append(
                {
                    "date": log.purchased_date.isoformat() if log.purchased_date else None,
                    "price": float(log.price) if log.price is not None else None,
                    "shopping_location": {
                        "id": store.id,
                        "name": store.name,
                        "description": store.description,
                        "row_created_timestamp": store.row_created_timestamp.isoformat(),
                    }
                    if store
                    else None,
                }
            )
        return result

    async def merge_products(self, actor: Actor, keep_id: int, remove_id: int) -> None:
        _ = actor
        if keep_id == remove_id:
            raise GrocyError("keep and remove product must differ", code="invalid_merge")
        keep = await self.products.get(keep_id)
        remove = await self.products.get(remove_id)
        keep_barcodes = {b.barcode for b in keep.barcodes}
        for barcode in list(remove.barcodes):
            if barcode.barcode in keep_barcodes:
                await self.session.delete(barcode)
            else:
                barcode.product_id = keep.id
                keep_barcodes.add(barcode.barcode)
        await self.session.execute(
            update(StockEntry).where(StockEntry.product_id == remove.id).values(product_id=keep.id)
        )
        await self.session.execute(
            update(StockLog).where(StockLog.product_id == remove.id).values(product_id=keep.id)
        )
        for model in (
            ShoppingListItem,
            RecipePosition,
            ProductNutrition,
            NutritionProposal,
            NutritionRevision,
            MealPlanEntry,
            QuantityUnitConversion,
        ):
            await self.session.execute(
                update(model).where(model.product_id == remove.id).values(product_id=keep.id)
            )
        await self.session.delete(remove)
        await self.session.commit()

    async def product_by_barcode(self, barcode: str) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.product_details(product.id)

    async def purchase_by_barcode(
        self,
        actor: Actor,
        barcode: str,
        amount: Decimal,
        **kwargs: Any,
    ) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.purchase(actor, product.id, amount, **kwargs)

    async def consume_by_barcode(
        self,
        actor: Actor,
        barcode: str,
        amount: Decimal,
        **kwargs: Any,
    ) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.consume(actor, product.id, amount, **kwargs)

    async def open_by_barcode(
        self,
        actor: Actor,
        barcode: str,
        amount: Decimal = Decimal("1"),
    ) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.open(actor, product.id, amount)

    async def transfer_by_barcode(
        self,
        actor: Actor,
        barcode: str,
        amount: Decimal,
        location_id_from: int,
        location_id_to: int,
    ) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.transfer(
            actor,
            product.id,
            amount,
            location_id_from,
            location_id_to,
        )

    async def inventory_by_barcode(
        self,
        actor: Actor,
        barcode: str,
        new_amount: Decimal,
        **kwargs: Any,
    ) -> dict:
        product = await self.products.get_by_barcode(barcode)
        return await self.inventory(actor, product.id, new_amount, **kwargs)

    async def location_entries(self, location_id: int) -> list[dict]:
        location = await self.session.get(Location, location_id)
        if location is None:
            raise NotFoundError(f"Location {location_id} not found")
        return await self.list_inventory(location_id=location_id)

    async def get_booking(self, booking_id: int) -> dict:
        log = await self.session.get(StockLog, booking_id)
        if log is None:
            raise NotFoundError(f"Booking {booking_id} not found")
        return self._serialize_log(log)

    async def get_transaction(self, transaction_id: str) -> list[dict]:
        stmt = select(StockLog).where(StockLog.transaction_id == transaction_id)
        logs = (await self.session.execute(stmt.order_by(StockLog.id))).scalars().all()
        if not logs:
            raise NotFoundError(f"Transaction {transaction_id} not found")
        return [self._serialize_log(log) for log in logs]

    async def undo_transaction(self, actor: Actor, transaction_id: str) -> dict:
        stmt = select(StockLog).where(
            StockLog.transaction_id == transaction_id,
            StockLog.undone == 0,
        )
        logs = (await self.session.execute(stmt.order_by(StockLog.id.desc()))).scalars().all()
        if not logs:
            raise NotFoundError(f"Transaction {transaction_id} not found")
        for log in logs:
            await self._undo_single(actor, log)
        await self.session.commit()
        return {
            "transaction_id": transaction_id,
            "undone": True,
            "bookings_undone": len(logs),
        }

    async def external_barcode_lookup(self, barcode: str, *, add: bool = False) -> dict:
        import httpx

        from grocy.core.config import get_settings
        from grocy.db.models.catalog import ProductBarcode, QuantityUnit

        if not barcode.isascii() or not barcode.isdigit() or not 4 <= len(barcode) <= 32:
            raise GrocyError("Barcode must contain 4 to 32 digits", code="invalid_barcode")
        url = get_settings().barcode_provider_url
        if not url:
            raise GrocyError("Barcode provider is disabled", status_code=503)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    url.format(barcode=barcode),
                    headers={"User-Agent": "GrocyNext/0.1 (household inventory)"},
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GrocyError("Barcode provider request failed", status_code=502) from exc
        if not isinstance(data, dict) or not isinstance(data.get("product", {}), dict):
            raise GrocyError("Barcode provider returned invalid data", status_code=502)
        raw = data.get("product", {})
        name = raw.get("product_name") or raw.get("generic_name")
        if not name:
            raise NotFoundError("Barcode provider has no product name")
        result = {"name": name, "barcode": barcode, "provider": "openfoodfacts", "product": raw}
        if add:
            existing = await self.session.scalar(
                select(ProductBarcode).where(ProductBarcode.barcode == barcode)
            )
            if existing:
                result["created_object_id"] = existing.product_id
            else:
                location = await self.session.scalar(
                    select(Location).order_by(Location.id).limit(1)
                )
                unit = await self.session.scalar(
                    select(QuantityUnit).order_by(QuantityUnit.id).limit(1)
                )
                if location is None or unit is None:
                    raise GrocyError("Create a location and quantity unit first")
                product = Product(
                    name=name, location_id=location.id, qu_id_purchase=unit.id, qu_id_stock=unit.id
                )
                self.session.add(product)
                await self.session.flush()
                self.session.add(ProductBarcode(product_id=product.id, barcode=barcode))
                await self.session.commit()
                result["created_object_id"] = product.id
        return result

    async def _undo_single(self, actor: Actor, log: StockLog) -> None:
        _ = actor
        snapshot = {}
        raw_snapshot = log.undo_data or (
            log.note if log.note and log.note.startswith("{") else None
        )
        if raw_snapshot:
            snapshot = json.loads(raw_snapshot).get("before", {})
        if (
            log.transaction_type in {"purchase", "inventory-correction", "self-production"}
            and log.amount > 0
        ):
            entries = list(
                (
                    await self.session.execute(
                        select(StockEntry).where(StockEntry.stock_id == log.stock_id)
                    )
                )
                .scalars()
                .all()
            )
            if sum((e.amount for e in entries), Decimal("0")) < log.amount:
                raise GrocyError("Undo later stock changes first", code="dependent_booking")
            remaining = log.amount
            for entry in entries:
                take = min(entry.amount, remaining)
                entry.amount -= take
                remaining -= take
                if entry.amount == 0:
                    await self.session.delete(entry)
                if remaining <= 0:
                    break
        elif log.transaction_type in {"consume", "inventory-correction"} and log.amount < 0:
            await self._restore_amount(log, snapshot, abs(log.amount))
        elif log.transaction_type == "product-opened":
            entry = await self.session.get(StockEntry, log.stock_row_id)
            if entry is None or entry.amount < log.amount:
                raise GrocyError("Undo later stock changes first", code="dependent_booking")
            if snapshot.get("stock_id") and snapshot["stock_id"] != entry.stock_id:
                await self.session.delete(entry)
                await self._restore_amount(log, snapshot, log.amount)
            else:
                entry.open = 0
                entry.opened_date = None
                if snapshot:
                    entry.location_id = snapshot.get("location_id")
                expiry = snapshot.get("best_before_date")
                if snapshot:
                    entry.best_before_date = date.fromisoformat(expiry) if expiry else None
        elif log.transaction_type == "transfer":
            entry = await self.session.get(StockEntry, log.stock_row_id)
            if entry is None or entry.amount < abs(log.amount):
                raise GrocyError("Undo later stock changes first", code="dependent_booking")
            entry.amount -= abs(log.amount)
            if entry.amount == 0:
                await self.session.delete(entry)
            if not snapshot:
                source_id = int((log.note or "from:0").split(":", 1)[1])
                snapshot = {"location_id": source_id}
            await self._restore_amount(log, snapshot, abs(log.amount))
        log.undone = 1
        log.undone_timestamp = datetime.now()
        await self.session.flush()

    async def _restore_amount(self, log: StockLog, snapshot: dict, amount: Decimal) -> None:
        stock_id = snapshot.get("stock_id") or log.stock_id or uuid.uuid4().hex
        entry = await self.session.scalar(select(StockEntry).where(StockEntry.stock_id == stock_id))
        if entry is not None:
            entry.amount += amount
            return
        opened = snapshot.get("opened_date")
        self.session.add(
            StockEntry(
                product_id=log.product_id,
                amount=amount,
                best_before_date=log.best_before_date,
                purchased_date=log.purchased_date,
                stock_id=stock_id,
                price=log.price,
                location_id=snapshot.get("location_id", log.location_id),
                open=snapshot.get("open", 0),
                opened_date=datetime.fromisoformat(opened) if opened else None,
                shopping_location_id=snapshot.get("shopping_location_id"),
                note=snapshot.get("note"),
            )
        )

    async def _ordered_entries(
        self,
        product_id: int,
        *,
        location_id: int | None = None,
    ) -> list[StockEntry]:
        stmt = select(StockEntry).where(StockEntry.product_id == product_id)
        if location_id is not None:
            stmt = stmt.where(StockEntry.location_id == location_id)
        stmt = stmt.order_by(
            StockEntry.open.desc(),
            StockEntry.best_before_date.is_(None),
            StockEntry.best_before_date.asc(),
            StockEntry.id.asc(),
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def _opened_amount(self, product_id: int) -> Decimal:
        stmt = select(StockEntry).where(
            StockEntry.product_id == product_id,
            StockEntry.open == 1,
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return sum((row.amount for row in rows), Decimal("0"))

    async def _add_log(
        self,
        *,
        actor: Actor,
        product_id: int,
        amount: Decimal,
        transaction_type: str,
        stock_id: str,
        best_before_date: date | None = None,
        purchased_date: date | None = None,
        used_date: date | None = None,
        spoiled: int = 0,
        price: Decimal | None = None,
        location_id: int | None = None,
        stock_row_id: int | None = None,
        transaction_id: str | None = None,
        note: str | None = None,
        undo_data: str | None = None,
        shopping_location_id: int | None = None,
        recipe_id: int | None = None,
    ) -> StockLog:
        log = StockLog(
            product_id=product_id,
            amount=amount,
            best_before_date=best_before_date,
            purchased_date=purchased_date,
            used_date=used_date,
            spoiled=spoiled,
            stock_id=stock_id,
            transaction_type=transaction_type,
            price=price,
            location_id=location_id,
            transaction_id=transaction_id or uuid.uuid4().hex,
            stock_row_id=stock_row_id,
            user_id=actor.user_id,
            note=note,
            undo_data=undo_data,
            shopping_location_id=shopping_location_id,
            recipe_id=recipe_id,
        )
        self.session.add(log)
        await self.session.flush()
        return log

    def _stock_overview_row(
        self,
        product: Product,
        amount: Decimal,
        opened: Decimal,
        best_before: date | None,
    ) -> dict:
        return {
            "product_id": product.id,
            "amount": float(amount),
            "amount_aggregated": float(amount),
            "amount_opened": float(opened),
            "amount_opened_aggregated": float(opened),
            "best_before_date": best_before.isoformat() if best_before else None,
            "is_aggregated_amount": False,
            "product": self.products.serialize(product),
        }

    def _serialize_log(self, log: StockLog) -> dict:
        return {
            "id": log.id,
            "product_id": log.product_id,
            "amount": float(log.amount),
            "best_before_date": (
                log.best_before_date.isoformat() if log.best_before_date else None
            ),
            "purchased_date": (log.purchased_date.isoformat() if log.purchased_date else None),
            "used_date": log.used_date.isoformat() if log.used_date else None,
            "spoiled": bool(log.spoiled),
            "stock_id": log.stock_id,
            "transaction_id": log.transaction_id,
            "transaction_type": log.transaction_type,
            "note": log.note,
            "row_created_timestamp": log.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }

    def _serialize_entry(self, row: StockEntry) -> dict:
        return {
            "id": row.id,
            "product_id": row.product_id,
            "amount": float(row.amount),
            "best_before_date": (
                row.best_before_date.isoformat() if row.best_before_date else None
            ),
            "purchased_date": (row.purchased_date.isoformat() if row.purchased_date else None),
            "location_id": row.location_id,
            "shopping_location_id": row.shopping_location_id,
            "open": row.open,
            "opened_date": (
                row.opened_date.date().isoformat() if row.opened_date is not None else None
            ),
            "stock_id": row.stock_id,
            "price": float(row.price) if row.price is not None else None,
            "note": row.note,
            "row_created_timestamp": row.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }
