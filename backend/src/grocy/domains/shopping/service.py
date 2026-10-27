from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.shopping import ShoppingList, ShoppingListItem
from grocy.domains.products.service import ProductsService


class ShoppingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.products = ProductsService(session)

    async def get_list(self, shopping_list_id: int = 1) -> dict:
        shopping_list = await self.session.get(ShoppingList, shopping_list_id)
        if shopping_list is None:
            raise NotFoundError(f"Shopping list {shopping_list_id} not found")
        stmt = (
            select(ShoppingListItem)
            .where(ShoppingListItem.shopping_list_id == shopping_list_id)
            .order_by(ShoppingListItem.id)
        )
        items = (await self.session.execute(stmt)).scalars().all()
        return {
            "id": shopping_list.id,
            "name": shopping_list.name,
            "items": [
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "amount": float(item.amount),
                    "note": item.note,
                    "done": bool(item.done),
                    "qu_id": item.qu_id,
                }
                for item in items
            ],
        }

    async def add_item(
        self,
        product_id: int,
        amount: Decimal = Decimal("1"),
        *,
        shopping_list_id: int = 1,
        note: str | None = None,
        qu_id: int | None = None,
    ) -> dict:
        from grocy.domains.units.service import UnitsService

        if not amount.is_finite() or amount <= 0:
            raise GrocyError("Amount must be positive", code="invalid_amount")
        product = await self.products.get(product_id)
        unit_id = qu_id or product.qu_id_purchase
        await UnitsService(self.session).convert(
            amount, unit_id, product.qu_id_stock, product_id=product_id
        )
        shopping_list = await self.session.get(ShoppingList, shopping_list_id)
        if shopping_list is None:
            raise NotFoundError(f"Shopping list {shopping_list_id} not found")
        item = ShoppingListItem(
            product_id=product_id,
            amount=amount,
            shopping_list_id=shopping_list_id,
            note=note,
            qu_id=unit_id,
        )
        self.session.add(item)
        await self.session.commit()
        await self.session.refresh(item)
        return {
            "id": item.id,
            "product_id": item.product_id,
            "amount": float(item.amount),
            "note": item.note,
            "done": bool(item.done),
            "qu_id": item.qu_id,
        }

    async def purchase_item(self, actor: Actor, shopping_list_id: int, item_id: int) -> dict:
        from grocy.domains.stock.service import StockService
        from grocy.domains.units.service import UnitsService

        await self._ensure_list(shopping_list_id)
        item = await self.session.get(ShoppingListItem, item_id)
        if item is None:
            return {"purchased": False, "bookings": []}
        if item.shopping_list_id != shopping_list_id:
            raise NotFoundError("Shopping item not found in this list")
        if not item.done:
            raise GrocyError("Check the shopping item before recording its purchase")
        bookings = []
        purchased = item.product_id is not None
        if item.product_id is not None:
            product = await self.products.get(item.product_id)
            amount = await UnitsService(self.session).convert(
                item.amount,
                item.qu_id or product.qu_id_stock,
                product.qu_id_stock,
                product_id=product.id,
            )
            bookings = await StockService(self.session).purchase(
                actor, product.id, amount, note=item.note, commit=False
            )
        await self.session.delete(item)
        await self.session.commit()
        return {"purchased": purchased, "bookings": bookings}

    async def ensure_item(
        self,
        product_id: int,
        amount: Decimal,
        *,
        shopping_list_id: int = 1,
        note: str | None = None,
    ) -> Decimal:
        from grocy.domains.units.service import UnitsService

        await self._ensure_list(shopping_list_id)
        product = await self.products.get(product_id)
        rows = (
            (
                await self.session.execute(
                    select(ShoppingListItem).where(
                        ShoppingListItem.product_id == product_id,
                        ShoppingListItem.shopping_list_id == shopping_list_id,
                        ShoppingListItem.done == 0,
                    )
                )
            )
            .scalars()
            .all()
        )
        present = Decimal("0")
        units = UnitsService(self.session)
        for row in rows:
            present += await units.convert(
                row.amount,
                row.qu_id or product.qu_id_stock,
                product.qu_id_stock,
                product_id=product_id,
            )
        missing = max(Decimal("0"), amount - present)
        if missing:
            await self._upsert_item(
                product_id, missing, shopping_list_id=shopping_list_id, note=note
            )
        return missing

    async def add_missing_products(self, *, shopping_list_id: int = 1, commit: bool = True) -> None:
        from grocy.domains.stock.service import StockService

        await self._ensure_list(shopping_list_id)
        volatile = await StockService(self.session).volatile()
        for missing in volatile["missing_products"]:
            product = await self.products.get(missing["id"])
            amount = Decimal(str(missing["amount_missing"])).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            item = await self.session.scalar(
                select(ShoppingListItem)
                .where(ShoppingListItem.product_id == product.id)
                .order_by(ShoppingListItem.id)
                .limit(1)
            )
            if item is None:
                self.session.add(
                    ShoppingListItem(
                        product_id=product.id,
                        amount=amount,
                        qu_id=product.qu_id_purchase,
                        shopping_list_id=shopping_list_id,
                    )
                )
            elif item.amount < amount:
                item.amount = amount
                item.shopping_list_id = shopping_list_id
        await self.session.flush()
        if commit:
            await self.session.commit()

    async def auto_add_missing(self) -> None:
        from grocy.compatibility import client_defaults
        from grocy.db.models.settings import UserSetting

        user_id = self.session.info.get("actor_user_id", 1)
        stored = (
            await self.session.scalars(select(UserSetting).where(UserSetting.user_id == user_id))
        ).all()
        settings = {**client_defaults()["user_settings"], **{row.key: row.value for row in stored}}
        enabled = settings.get("shopping_list_auto_add_below_min_stock_amount")
        if enabled and enabled != "0":
            list_id = settings["shopping_list_auto_add_below_min_stock_amount_list_id"]
            if list_id is None:
                raise GrocyError("Missing shopping list ID", code=None)
            await self.add_missing_products(
                shopping_list_id=int(list_id),
                commit=False,
            )

    async def add_overdue_products(self, *, shopping_list_id: int = 1) -> None:
        await self._add_due_products("overdue_products", shopping_list_id)

    async def add_expired_products(self, *, shopping_list_id: int = 1) -> None:
        await self._add_due_products("expired_products", shopping_list_id)

    async def _add_due_products(self, key: str, shopping_list_id: int) -> None:
        from grocy.domains.stock.service import StockService

        await self._ensure_list(shopping_list_id)
        volatile = await StockService(self.session).volatile()
        for row in volatile[key]:
            product = await self.products.get(row["product_id"])
            existing = await self.session.scalar(
                select(ShoppingListItem.id)
                .where(ShoppingListItem.product_id == product.id)
                .limit(1)
            )
            if existing is None:
                self.session.add(
                    ShoppingListItem(
                        product_id=product.id,
                        amount=Decimal("1"),
                        qu_id=product.qu_id_purchase,
                        shopping_list_id=shopping_list_id,
                    )
                )
        await self.session.commit()

    async def clear_list(
        self,
        *,
        shopping_list_id: int = 1,
        done_only: bool = False,
    ) -> None:
        await self._ensure_list(shopping_list_id)
        stmt = delete(ShoppingListItem).where(ShoppingListItem.shopping_list_id == shopping_list_id)
        if done_only:
            stmt = stmt.where(ShoppingListItem.done == 1)
        await self.session.execute(stmt)
        await self.session.commit()

    async def add_product(
        self,
        product_id: int,
        amount: Decimal = Decimal("1"),
        *,
        shopping_list_id: int = 1,
        note: str | None = None,
        qu_id: int | None = None,
    ) -> None:
        await self._ensure_list(shopping_list_id)
        product = await self.products.get(product_id)
        if not product.active:
            raise GrocyError("Product is inactive")
        item = await self.session.scalar(
            select(ShoppingListItem)
            .where(
                ShoppingListItem.product_id == product_id,
                ShoppingListItem.shopping_list_id == shopping_list_id,
            )
            .order_by(ShoppingListItem.id)
            .limit(1)
        )
        if item is None:
            self.session.add(
                ShoppingListItem(
                    product_id=product_id,
                    amount=amount,
                    qu_id=product.qu_id_purchase if qu_id in (None, -1) else qu_id,
                    shopping_list_id=shopping_list_id,
                    note=note,
                )
            )
        else:
            item.amount += amount
            item.note = note
        await self.session.commit()

    async def remove_product(
        self,
        product_id: int,
        amount: Decimal = Decimal("1"),
        *,
        shopping_list_id: int = 1,
    ) -> None:
        await self._ensure_list(shopping_list_id)
        stmt = (
            select(ShoppingListItem)
            .where(
                ShoppingListItem.product_id == product_id,
            )
            .order_by(ShoppingListItem.id)
        )
        item = (await self.session.execute(stmt)).scalars().first()
        if item is None:
            await self.session.commit()
            return
        from grocy.compatibility import client_defaults
        from grocy.db.models.settings import UserSetting

        precision = await self.session.scalar(
            select(UserSetting.value).where(
                UserSetting.user_id == self.session.info.get("actor_user_id", 1),
                UserSetting.key == "stock_decimal_places_amounts",
            )
        )
        if precision is None:
            precision = client_defaults()["user_settings"]["stock_decimal_places_amounts"]
        item.amount -= amount
        if item.amount < Decimal("10") ** -max(1, int(precision)):
            await self.session.delete(item)
        await self.session.commit()

    async def _ensure_list(self, shopping_list_id: int) -> ShoppingList:
        shopping_list = await self.session.get(ShoppingList, shopping_list_id)
        if shopping_list is None:
            raise NotFoundError(f"Shopping list {shopping_list_id} not found")
        return shopping_list

    async def _upsert_item(
        self,
        product_id: int,
        amount: Decimal,
        *,
        shopping_list_id: int = 1,
        note: str | None = None,
    ) -> None:
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("Amount must be positive", code="invalid_amount")
        stmt = select(ShoppingListItem).where(
            ShoppingListItem.shopping_list_id == shopping_list_id,
            ShoppingListItem.product_id == product_id,
        )
        item = (await self.session.execute(stmt)).scalars().first()
        if item is None:
            item = ShoppingListItem(
                product_id=product_id,
                amount=amount,
                shopping_list_id=shopping_list_id,
                note=note,
                qu_id=(await self.products.get(product_id)).qu_id_stock,
            )
            self.session.add(item)
        else:
            if item.qu_id:
                from grocy.domains.units.service import UnitsService

                product = await self.products.get(product_id)
                amount = await UnitsService(self.session).convert(
                    amount, product.qu_id_stock, item.qu_id, product_id=product_id
                )
            item.amount += amount
            if note is not None:
                item.note = note
        await self.session.commit()
