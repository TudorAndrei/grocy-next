"""Read models for the exposed Grocy view entities."""

from decimal import Decimal

from sqlalchemy import select

from grocy.core.errors import GrocyError
from grocy.core.permissions import PERMISSIONS
from grocy.db.models.catalog import Product, ProductBarcode
from grocy.db.models.stock import StockLog
from grocy.domains.products.service import ProductsService
from grocy.domains.recipes.service import RecipesService
from grocy.domains.stock.history import StockHistory
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
        rows = list((await session.execute(select(StockLog).order_by(StockLog.id))).scalars().all())
        grouped: dict[int, list] = {}
        for row in rows:
            grouped.setdefault(row.product_id, []).append(row)
        result = []
        for pid, logs in grouped.items():
            history = StockHistory(logs)
            if entity == "products_last_purchased":
                last = history.last_purchased_row(pid)
                if last:
                    result.append(last)
            elif history.average_price is not None:
                price = float(history.average_price)
                result.append({"id": 1, "product_id": pid, "price": price, "avg_price": price})
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
        all_products = (await session.execute(select(Product).order_by(Product.id))).scalars().all()
        result.extend(
            {
                "id": product.id,
                "product_id": product.id,
                "barcode": f"grcy:p:{product.id}",
                "qu_id": product.qu_id_stock,
                "amount": None,
                "shopping_location_id": None,
                "last_price": None,
                "note": None,
            }
            for product in all_products
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
