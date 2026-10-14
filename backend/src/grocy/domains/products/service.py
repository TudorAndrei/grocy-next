from __future__ import annotations

from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.errors import NotFoundError
from grocy.db.models.catalog import Product, ProductBarcode
from grocy.db.models.stock import StockEntry


class ProductsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_products(self) -> list[Product]:
        stmt = (
            select(Product)
            .options(selectinload(Product.barcodes))
            .where(Product.active == 1)
            .order_by(Product.name)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_by_barcode(self, barcode: str) -> Product:
        stmt = (
            select(Product)
            .join(ProductBarcode, ProductBarcode.product_id == Product.id)
            .options(selectinload(Product.barcodes))
            .where(ProductBarcode.barcode == barcode, Product.active == 1)
        )
        product = (await self.session.execute(stmt)).scalars().first()
        if product is None:
            raise NotFoundError(f"Unknown barcode {barcode}")
        return product

    async def get(self, product_id: int) -> Product:
        stmt = (
            select(Product)
            .options(selectinload(Product.barcodes))
            .where(Product.id == product_id)
        )
        product = (await self.session.execute(stmt)).scalars().first()
        if product is None:
            raise NotFoundError(f"Product {product_id} not found")
        return product

    async def search(self, query: str, *, limit: int = 25) -> list[Product]:
        q = query.strip()
        if not q:
            return []
        pattern = f"%{q}%"
        barcode_ids = select(ProductBarcode.product_id).where(ProductBarcode.barcode == q)
        stmt = (
            select(Product)
            .options(selectinload(Product.barcodes))
            .where(
                Product.active == 1,
                or_(
                    Product.name.ilike(pattern),
                    Product.description.ilike(pattern),
                    Product.id.in_(barcode_ids),
                ),
            )
            .order_by(Product.name)
            .limit(limit)
        )
        exact = (
            select(Product)
            .options(selectinload(Product.barcodes))
            .where(Product.active == 1, Product.id.in_(barcode_ids))
        )
        exact_rows = list((await self.session.execute(exact)).scalars().all())
        fuzzy_rows = list((await self.session.execute(stmt)).scalars().all())
        seen: set[int] = set()
        ordered: list[Product] = []
        for row in exact_rows + fuzzy_rows:
            if row.id not in seen:
                seen.add(row.id)
                ordered.append(row)
        return ordered[:limit]

    async def stock_amount(self, product_id: int) -> Decimal:
        stmt = select(StockEntry.amount).where(StockEntry.product_id == product_id)
        amounts = (await self.session.execute(stmt)).scalars().all()
        return sum((amount for amount in amounts), Decimal("0"))

    def serialize(self, product: Product, *, stock_amount: Decimal | None = None) -> dict:
        barcodes = [b.barcode for b in product.barcodes]
        payload = {
            "id": product.id,
            "name": product.name,
            "description": product.description,
            "location_id": product.location_id,
            "qu_id_purchase": product.qu_id_purchase,
            "qu_id_stock": product.qu_id_stock,
            "qu_factor_purchase_to_stock": float(product.qu_factor_purchase_to_stock),
            "min_stock_amount": float(product.min_stock_amount),
            "default_best_before_days": product.default_best_before_days,
            "product_group_id": product.product_group_id,
            "active": product.active,
            "barcode": barcodes[0] if barcodes else None,
            "barcodes": barcodes,
        }
        if stock_amount is not None:
            payload["stock_amount"] = float(stock_amount)
        return payload
