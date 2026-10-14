from __future__ import annotations

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


class StockService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.products = ProductsService(session)

    async def list_inventory(
        self,
        *,
        product_id: int | None = None,
        location_id: int | None = None,
    ) -> list[dict]:
        stmt = select(StockEntry)
        if product_id is not None:
            stmt = stmt.where(StockEntry.product_id == product_id)
        if location_id is not None:
            stmt = stmt.where(StockEntry.location_id == location_id)
        if product_id is not None:
            rows = await self._ordered_entries(product_id, location_id=location_id)
        else:
            rows = list(
                (await self.session.execute(stmt.order_by(StockEntry.id))).scalars().all()
            )
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
        price: Decimal | None = None,
        location_id: int | None = None,
    ) -> dict:
        if amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        stock_id = uuid.uuid4().hex
        entry = StockEntry(
            product_id=product.id,
            amount=amount,
            best_before_date=best_before_date,
            purchased_date=date.today(),
            stock_id=stock_id,
            price=price,
            location_id=location_id or product.location_id,
        )
        self.session.add(entry)
        await self.session.flush()
        log = await self._add_log(
            actor=actor,
            product_id=product.id,
            amount=amount,
            transaction_type="purchase",
            stock_id=stock_id,
            best_before_date=best_before_date,
            purchased_date=date.today(),
            price=price,
            location_id=entry.location_id,
            stock_row_id=entry.id,
        )
        await self.session.commit()
        return {
            "id": log.id,
            "product_id": product.id,
            "amount": float(amount),
            "stock_id": stock_id,
            "transaction_type": "purchase",
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
    ) -> dict:
        _ = allow_subproduct_substitution
        if amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        await self.products.get(product_id)
        remaining = amount
        entries = await self._ordered_entries(product_id, location_id=location_id)
        total = sum((entry.amount for entry in entries), Decimal("0"))
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
            take = min(entry.amount, remaining)
            entry.amount -= take
            remaining -= take
            log = await self._add_log(
                actor=actor,
                product_id=product_id,
                amount=-take,
                transaction_type="consume",
                stock_id=entry.stock_id,
                best_before_date=entry.best_before_date,
                used_date=date.today(),
                spoiled=1 if spoiled else 0,
                location_id=entry.location_id,
                stock_row_id=entry.id,
                transaction_id=transaction_id,
            )
            last_log_id = log.id
            if entry.amount == 0:
                await self.session.delete(entry)
        await self.session.commit()
        return {
            "id": last_log_id,
            "product_id": product_id,
            "amount": float(amount),
            "transaction_type": "consume",
            "transaction_id": transaction_id,
        }

    async def open(
        self,
        actor: Actor,
        product_id: int,
        amount: Decimal = Decimal("1"),
    ) -> dict:
        if amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        await self.products.get(product_id)
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
            take = min(entry.amount, remaining)
            if take < entry.amount:
                new_entry = StockEntry(
                    product_id=entry.product_id,
                    amount=take,
                    best_before_date=entry.best_before_date,
                    purchased_date=entry.purchased_date,
                    stock_id=uuid.uuid4().hex,
                    price=entry.price,
                    open=1,
                    opened_date=datetime.now(),
                    location_id=entry.location_id,
                )
                entry.amount -= take
                self.session.add(new_entry)
                await self.session.flush()
                stock_row_id = new_entry.id
                stock_id = new_entry.stock_id
            else:
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
        if amount <= 0:
            raise GrocyError("amount must be positive", code="invalid_amount")
        await self.products.get(product_id)
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
                location_id=location_id_to,
                stock_row_id=dest.id,
                transaction_id=transaction_id,
                note=f"from:{location_id_from}",
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
    ) -> dict:
        if new_amount < 0:
            raise GrocyError("new amount must be non-negative", code="invalid_amount")
        product = await self.products.get(product_id)
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
            stock_id = uuid.uuid4().hex
            entry = StockEntry(
                product_id=product_id,
                amount=delta,
                best_before_date=best_before_date,
                purchased_date=date.today(),
                stock_id=stock_id,
                location_id=loc,
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
            await self.session.execute(
                select(StockLog).where(
                    StockLog.transaction_id == log.transaction_id,
                    StockLog.undone == 0,
                )
            )
        ).scalars().all()
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
        product = await self.products.get(product_id)
        amount = await self.products.stock_amount(product_id)
        opened = await self._opened_amount(product_id)
        return {
            **self.products.serialize(product, stock_amount=amount),
            "stock_amount_opened": float(opened),
        }

    async def get_entry(self, entry_id: int) -> dict:
        entry = await self.session.get(StockEntry, entry_id)
        if entry is None:
            raise NotFoundError(f"Stock entry {entry_id} not found")
        return self._serialize_entry(entry)

    async def edit_entry(self, entry_id: int, **fields: Any) -> list[dict]:
        entry = await self.session.get(StockEntry, entry_id)
        if entry is None:
            raise NotFoundError(f"Stock entry {entry_id} not found")
        actor = Actor(user_id=1, username="system")
        logs: list[dict] = []
        amount = fields.get("amount")
        if amount is not None:
            new_amount = Decimal(str(amount))
            if new_amount < 0:
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
        if fields.get("best_before_date") is not None:
            entry.best_before_date = fields["best_before_date"]
        if fields.get("purchased_date") is not None:
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

            if amount < product.min_stock_amount:
                missing = product.min_stock_amount - amount
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

    async def product_locations(self, product_id: int) -> list[dict]:
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
            .where(StockEntry.product_id == product_id, StockEntry.amount > 0)
            .order_by(Location.name, StockEntry.id)
        )
        rows = (await self.session.execute(stmt)).all()
        aggregated: dict[int | None, dict] = {}
        for location_id, name, is_freezer, amount, entry_id in rows:
            key = location_id
            if key not in aggregated:
                aggregated[key] = {
                    "id": entry_id,
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
        await self.products.get(product_id)
        stmt = (
            select(StockLog)
            .where(
                StockLog.product_id == product_id,
                StockLog.transaction_type == "purchase",
                StockLog.price.is_not(None),
                StockLog.undone == 0,
            )
            .order_by(StockLog.row_created_timestamp.desc())
        )
        logs = (await self.session.execute(stmt)).scalars().all()
        return [
            {
                "date": log.row_created_timestamp.isoformat(sep=" ", timespec="seconds"),
                "price": float(log.price) if log.price is not None else None,
                "shopping_location": None,
            }
            for log in logs
        ]

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
            update(StockEntry)
            .where(StockEntry.product_id == remove.id)
            .values(product_id=keep.id)
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

    async def external_barcode_lookup(self, barcode: str) -> dict:
        return {"name": None, "barcode": barcode, "provider": "none"}

    async def _undo_single(self, actor: Actor, log: StockLog) -> None:
        _ = actor
        if log.transaction_type in {"purchase", "inventory-correction"} and log.amount > 0:
            entries = (
                await self.session.execute(
                    select(StockEntry).where(StockEntry.stock_id == log.stock_id)
                )
            ).scalars().all()
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
            entry = StockEntry(
                product_id=log.product_id,
                amount=abs(log.amount),
                best_before_date=log.best_before_date,
                purchased_date=log.purchased_date,
                stock_id=log.stock_id or uuid.uuid4().hex,
                price=log.price,
                location_id=log.location_id,
            )
            self.session.add(entry)
        elif log.transaction_type == "product-opened":
            entry = await self.session.get(StockEntry, log.stock_row_id)
            if entry is not None:
                entry.open = 0
                entry.opened_date = None
        elif log.transaction_type == "transfer":
            entry = await self.session.get(StockEntry, log.stock_row_id)
            if entry is not None:
                await self.session.delete(entry)
            note = log.note or ""
            source_id = None
            if note.startswith("from:"):
                try:
                    source_id = int(note.split(":", 1)[1])
                except ValueError:
                    source_id = None
            restored = StockEntry(
                product_id=log.product_id,
                amount=abs(log.amount),
                best_before_date=log.best_before_date,
                purchased_date=log.purchased_date,
                stock_id=uuid.uuid4().hex,
                price=log.price,
                location_id=source_id,
            )
            self.session.add(restored)
        log.undone = 1
        log.undone_timestamp = datetime.now()

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
            "purchased_date": (
                log.purchased_date.isoformat() if log.purchased_date else None
            ),
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
            "purchased_date": (
                row.purchased_date.isoformat() if row.purchased_date else None
            ),
            "location_id": row.location_id,
            "shopping_location_id": row.shopping_location_id,
            "open": row.open,
            "opened_date": (
                row.opened_date.date().isoformat()
                if row.opened_date is not None
                else None
            ),
            "stock_id": row.stock_id,
            "price": float(row.price) if row.price is not None else None,
            "row_created_timestamp": row.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }
