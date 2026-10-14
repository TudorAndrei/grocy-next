from __future__ import annotations

from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    ) -> dict:
        if not amount.is_finite() or amount <= 0:
            raise GrocyError("Amount must be positive", code="invalid_amount")
        await self.products.get(product_id)
        shopping_list = await self.session.get(ShoppingList, shopping_list_id)
        if shopping_list is None:
            raise NotFoundError(f"Shopping list {shopping_list_id} not found")
        item = ShoppingListItem(
            product_id=product_id,
            amount=amount,
            shopping_list_id=shopping_list_id,
            note=note,
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
        }

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

    async def add_missing_products(self, *, shopping_list_id: int = 1) -> None:
        from grocy.domains.stock.service import StockService

        await self._ensure_list(shopping_list_id)
        stock = StockService(self.session)
        volatile = await stock.volatile()
        for item in volatile["missing_products"]:
            amount = Decimal(str(item["amount_missing"]))
            await self.ensure_item(item["id"], amount, shopping_list_id=shopping_list_id)

    async def add_overdue_products(self, *, shopping_list_id: int = 1) -> None:
        from grocy.domains.stock.service import StockService

        await self._ensure_list(shopping_list_id)
        stock = StockService(self.session)
        volatile = await stock.volatile()
        for row in volatile["overdue_products"]:
            product_id = row["product_id"]
            await self.ensure_item(product_id, Decimal("1"), shopping_list_id=shopping_list_id)

    async def add_expired_products(self, *, shopping_list_id: int = 1) -> None:
        from grocy.domains.stock.service import StockService

        await self._ensure_list(shopping_list_id)
        stock = StockService(self.session)
        volatile = await stock.volatile()
        for row in volatile["expired_products"]:
            product_id = row["product_id"]
            await self.ensure_item(product_id, Decimal("1"), shopping_list_id=shopping_list_id)

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
        if qu_id is not None:
            from grocy.domains.units.service import UnitsService

            amount = await UnitsService(self.session).convert(
                amount, qu_id, product.qu_id_stock, product_id=product_id
            )
        await self._upsert_item(
            product_id,
            amount,
            shopping_list_id=shopping_list_id,
            note=note,
        )

    async def remove_product(
        self,
        product_id: int,
        amount: Decimal = Decimal("1"),
        *,
        shopping_list_id: int = 1,
    ) -> None:
        await self._ensure_list(shopping_list_id)
        stmt = select(ShoppingListItem).where(
            ShoppingListItem.shopping_list_id == shopping_list_id,
            ShoppingListItem.product_id == product_id,
        )
        item = (await self.session.execute(stmt)).scalars().first()
        if item is None:
            await self.session.commit()
            return
        item.amount -= amount
        if item.amount <= 0:
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
