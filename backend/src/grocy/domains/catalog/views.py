"""Read models for the exposed Grocy view entities."""

from decimal import Decimal

from sqlalchemy import select

from grocy.core.errors import GrocyError
from grocy.core.permissions import PERMISSIONS
from grocy.db.models.catalog import ProductBarcode
from grocy.db.models.stock import StockLog
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.stock.service import StockService
from grocy.domains.units.service import UnitsService

VIEW_ENTITIES = {
    "stock_current_locations",
    "products_last_purchased",
    "products_average_price",
    "quantity_unit_conversions_resolved",
    "recipes_pos_resolved",
    "product_barcodes_view",
    "permission_hierarchy",
}


async def list_view(session, entity: str) -> list[dict]:
    if entity == "permission_hierarchy":
        return [
            {"id": pid, "name": name, "parent": parent}
            for pid, (name, parent) in PERMISSIONS.items()
        ]
    products = ProductsService(session)
    if entity == "stock_current_locations":
        stock = StockService(session)
        result = []
        for product in await products.list_products():
            result.extend(await stock.product_locations(product.id))
        return result
    if entity in {"products_last_purchased", "products_average_price"}:
        rows = (
            (
                await session.execute(
                    select(StockLog)
                    .where(StockLog.transaction_type == "purchase", StockLog.undone == 0)
                    .order_by(StockLog.id)
                )
            )
            .scalars()
            .all()
        )
        grouped: dict[int, list] = {}
        for row in rows:
            grouped.setdefault(row.product_id, []).append(row)
        result = []
        for pid, logs in grouped.items():
            last = logs[-1]
            priced = [log for log in logs if log.price is not None]
            weight = sum((log.amount for log in priced), Decimal("0"))
            average = (
                sum((log.amount * log.price for log in priced), Decimal("0")) / weight
                if weight
                else None
            )
            result.append(
                {
                    "id": pid,
                    "product_id": pid,
                    "last_purchased": last.purchased_date.isoformat()
                    if last.purchased_date
                    else None,
                    "last_price": float(last.price) if last.price is not None else None,
                    "last_shopping_location_id": last.shopping_location_id,
                    "avg_price": float(average) if average is not None else None,
                }
            )
        return result
    if entity == "product_barcodes_view":
        rows = (
            (await session.execute(select(ProductBarcode).order_by(ProductBarcode.id)))
            .scalars()
            .all()
        )
        result = []
        for row in rows:
            product = await products.get(row.product_id)
            result.append(
                {
                    "id": row.id,
                    "product_id": row.product_id,
                    "product_name": product.name,
                    "barcode": row.barcode,
                    "qu_id": row.qu_id,
                    "amount": float(row.amount) if row.amount is not None else None,
                    "note": row.note,
                    "last_price": float(row.last_price) if row.last_price is not None else None,
                    "shopping_location_id": row.shopping_location_id,
                }
            )
        return result
    if entity == "recipes_pos_resolved":
        recipes = RecipesService(session)
        result = []
        for recipe in await recipes.list_recipes():
            for position in (await recipes.fulfillment(recipe.id))["positions"]:
                result.append(
                    {
                        "id": len(result) + 1,
                        "recipe_id": recipe.id,
                        **position,
                        "amount": position["amount_needed"],
                        "stock_amount": position["amount_available"],
                    }
                )
        return result
    if entity == "quantity_unit_conversions_resolved":
        units = UnitsService(session)
        quantity_units = await units.list_units()
        result = []
        for pid in [None, *(product.id for product in await products.list_products())]:
            for source in quantity_units:
                for target in quantity_units:
                    try:
                        factor = await units.convert(
                            Decimal("1"), source.id, target.id, product_id=pid
                        )
                    except GrocyError:
                        continue
                    result.append(
                        {
                            "id": len(result) + 1,
                            "product_id": pid,
                            "from_qu_id": source.id,
                            "to_qu_id": target.id,
                            "factor": float(factor),
                        }
                    )
        return result
    return []
