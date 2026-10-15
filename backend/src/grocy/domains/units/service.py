from __future__ import annotations

from decimal import Decimal

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.catalog import Product, QuantityUnit
from grocy.db.models.units import QuantityUnitConversion


class UnitsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_units(self) -> list[QuantityUnit]:
        stmt = select(QuantityUnit).order_by(QuantityUnit.name)
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_conversions(
        self,
        *,
        product_id: int | None = None,
    ) -> list[QuantityUnitConversion]:
        stmt = select(QuantityUnitConversion).order_by(QuantityUnitConversion.id)
        if product_id is not None:
            stmt = stmt.where(
                or_(
                    QuantityUnitConversion.product_id == product_id,
                    QuantityUnitConversion.product_id.is_(None),
                )
            )
        return list((await self.session.execute(stmt)).scalars().all())

    async def add_conversion(
        self,
        from_qu_id: int,
        to_qu_id: int,
        factor: Decimal,
        *,
        product_id: int | None = None,
    ) -> QuantityUnitConversion:
        if from_qu_id == to_qu_id:
            raise GrocyError("from and to quantity units must differ", code="invalid_conversion")
        if factor <= 0:
            raise GrocyError("conversion factor must be positive", code="invalid_factor")
        for qu_id in (from_qu_id, to_qu_id):
            if await self.session.get(QuantityUnit, qu_id) is None:
                raise NotFoundError(f"Quantity unit {qu_id} not found")
        if product_id is not None and await self.session.get(Product, product_id) is None:
            raise NotFoundError(f"Product {product_id} not found")
        row = QuantityUnitConversion(
            from_qu_id=from_qu_id,
            to_qu_id=to_qu_id,
            factor=factor,
            product_id=product_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.sync_inverse(row)
        await self.session.commit()
        await self.session.refresh(row)
        return row

    async def sync_inverse(
        self, row: QuantityUnitConversion, *, previous: tuple[int, int, int | None] | None = None
    ) -> None:
        source, target, product_id = previous or (row.from_qu_id, row.to_qu_id, row.product_id)
        inverse = await self.session.scalar(
            select(QuantityUnitConversion).where(
                QuantityUnitConversion.from_qu_id == target,
                QuantityUnitConversion.to_qu_id == source,
                QuantityUnitConversion.product_id == product_id,
                QuantityUnitConversion.id != row.id,
            )
        )
        if inverse is None:
            inverse = QuantityUnitConversion()
            self.session.add(inverse)
        inverse.from_qu_id = row.to_qu_id
        inverse.to_qu_id = row.from_qu_id
        inverse.product_id = row.product_id
        inverse.factor = Decimal("1") / row.factor
        await self.session.flush()

    async def convert(
        self,
        amount: Decimal,
        from_qu_id: int,
        to_qu_id: int,
        *,
        product_id: int | None = None,
    ) -> Decimal:
        if from_qu_id == to_qu_id:
            return amount
        factor = await self._resolve_factor(from_qu_id, to_qu_id, product_id=product_id)
        if factor is None:
            raise GrocyError(
                f"no conversion path from {from_qu_id} to {to_qu_id}",
                code="missing_conversion",
            )
        return amount * factor

    async def _resolve_factor(
        self,
        from_qu_id: int,
        to_qu_id: int,
        *,
        product_id: int | None,
    ) -> Decimal | None:
        if product_id is not None:
            resolved = await self.session.scalar(
                text(
                    "SELECT factor FROM quantity_unit_conversions_resolved "
                    "WHERE product_id = :product_id AND from_qu_id = :from_id "
                    "AND to_qu_id = :to_id LIMIT 1"
                ),
                {"product_id": product_id, "from_id": from_qu_id, "to_id": to_qu_id},
            )
            if resolved is not None:
                return Decimal(str(resolved))
            product = await self.session.get(Product, product_id)
            if product is not None:
                if from_qu_id == product.qu_id_purchase and to_qu_id == product.qu_id_stock:
                    return Decimal(product.qu_factor_purchase_to_stock)
                if (
                    from_qu_id == product.qu_id_stock
                    and to_qu_id == product.qu_id_purchase
                    and product.qu_factor_purchase_to_stock != 0
                ):
                    return Decimal("1") / Decimal(product.qu_factor_purchase_to_stock)

        edges = await self._conversion_edges(product_id=product_id)
        visited = {from_qu_id: Decimal("1")}
        queue = [from_qu_id]
        while queue:
            current = queue.pop(0)
            if current == to_qu_id:
                return visited[current]
            for nxt, factor in edges.get(current, []):
                if nxt in visited:
                    continue
                visited[nxt] = visited[current] * factor
                queue.append(nxt)
        return None

    async def ensure_product_conversions(self, product: Product) -> None:
        for source, factor in (
            (product.qu_id_purchase, product.qu_factor_purchase_to_stock),
            (product.qu_id_consume, Decimal("1")),
            (product.qu_id_price, Decimal("1")),
        ):
            if not source or source == product.qu_id_stock:
                continue
            existing = await self.session.scalar(
                text(
                    "SELECT factor FROM quantity_unit_conversions_resolved "
                    "WHERE product_id = :product_id AND from_qu_id = :from_id "
                    "AND to_qu_id = :to_id LIMIT 1"
                ),
                {"product_id": product.id, "from_id": source, "to_id": product.qu_id_stock},
            )
            if existing is None:
                row = QuantityUnitConversion(
                    from_qu_id=source,
                    to_qu_id=product.qu_id_stock,
                    product_id=product.id,
                    factor=factor,
                )
                self.session.add(row)
                await self.session.flush()
                await self.sync_inverse(row)

    async def _conversion_edges(
        self,
        *,
        product_id: int | None,
    ) -> dict[int, list[tuple[int, Decimal]]]:
        rows = await self.list_conversions(product_id=product_id)
        product_rows = [r for r in rows if product_id is not None and r.product_id == product_id]
        global_rows = [r for r in rows if r.product_id is None]
        preferred = product_rows + global_rows
        edges: dict[int, list[tuple[int, Decimal]]] = {}
        for row in preferred:
            edges.setdefault(row.from_qu_id, []).append((row.to_qu_id, Decimal(row.factor)))
            if row.factor != 0:
                edges.setdefault(row.to_qu_id, []).append(
                    (row.from_qu_id, Decimal("1") / Decimal(row.factor))
                )
        return edges

    def serialize_unit(self, unit: QuantityUnit) -> dict:
        return {
            "id": unit.id,
            "name": unit.name,
            "name_plural": unit.name_plural,
            "description": unit.description,
            "active": unit.active,
            "plural_forms": unit.plural_forms,
            "row_created_timestamp": unit.row_created_timestamp.isoformat(),
        }

    def serialize_conversion(self, row: QuantityUnitConversion) -> dict:
        return {
            "id": row.id,
            "from_qu_id": row.from_qu_id,
            "to_qu_id": row.to_qu_id,
            "factor": float(row.factor),
            "product_id": row.product_id,
        }
