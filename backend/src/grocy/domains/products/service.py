from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.catalog import Product, ProductBarcode
from grocy.db.models.stock import StockEntry
from grocy.domains.products.barcodes import parse_product_code


class ProductsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_products(self, *, include_inactive: bool = False) -> list[Product]:
        stmt = select(Product).options(selectinload(Product.barcodes)).order_by(Product.name)
        if not include_inactive:
            stmt = stmt.where(Product.active == 1)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_by_barcode(self, barcode: str) -> Product:
        code = parse_product_code(barcode)
        if code:
            product = await self.get(code[0])
            if not product.active:
                raise NotFoundError("Product is inactive")
            return product
        stmt = (
            select(Product)
            .join(ProductBarcode, ProductBarcode.product_id == Product.id)
            .options(selectinload(Product.barcodes))
            .where(func.lower(ProductBarcode.barcode) == barcode.lower(), Product.active == 1)
        )
        product = (await self.session.execute(stmt)).scalars().first()
        if product is None:
            raise NotFoundError(f"Unknown barcode {barcode}")
        return product

    async def get(self, product_id: int) -> Product:
        stmt = (
            select(Product).options(selectinload(Product.barcodes)).where(Product.id == product_id)
        )
        product = (await self.session.execute(stmt)).scalars().first()
        if product is None:
            raise NotFoundError(f"Product {product_id} not found")
        return product

    async def get_active(self, product_id: int) -> Product:
        try:
            product = await self.get(product_id)
        except NotFoundError as exc:
            raise GrocyError("Product does not exist") from exc
        if not product.active:
            raise GrocyError("Product does not exist")
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
        for column in product.__table__.columns:
            if column.name in payload:
                continue
            value = getattr(product, column.name)
            payload[column.name] = (
                value.isoformat(sep=" ", timespec="seconds")
                if hasattr(value, "isoformat")
                else float(value)
                if isinstance(value, Decimal)
                else value
            )
        if stock_amount is not None:
            payload["stock_amount"] = float(stock_amount)
        return payload

    async def child_ids(self, product_id: int) -> list[int]:
        ids, pending = [], [product_id]
        while pending:
            current = pending.pop()
            if current in ids:
                continue
            ids.append(current)
            children = (
                (
                    await self.session.execute(
                        select(Product.id).where(Product.parent_product_id == current)
                    )
                )
                .scalars()
                .all()
            )
            pending.extend(children)
        return ids
