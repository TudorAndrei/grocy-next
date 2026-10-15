"""State changes required by Grocy's catalog write rules."""

import json
from decimal import Decimal

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError
from grocy.db.models.catalog import Product, ProductBarcode, QuantityUnit
from grocy.db.models.household import Battery, BatteryChargeCycle, Chore, ChoreLog
from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.models.nutrition import (
    NutritionEvidence,
    NutritionProposal,
    NutritionRevision,
    ProductNutrition,
)
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
from grocy.db.models.settings import UserEntity, UserfieldDefinition, UserfieldValue, UserObject
from grocy.db.models.shopping import ShoppingList, ShoppingListItem
from grocy.db.models.stock import CachedAveragePrice, CachedLastPurchase, StockEntry, StockLog
from grocy.db.models.units import QuantityUnitConversion


class CatalogEffects:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def change_stock_unit(self, product: Product, old_unit: int) -> None:
        if product.qu_id_stock == old_unit:
            return
        raw_factor = await self.session.scalar(
            text(
                "SELECT factor FROM quantity_unit_conversions_resolved "
                "WHERE product_id = :product AND from_qu_id = :source "
                "AND to_qu_id = :target LIMIT 1"
            ),
            {"product": product.id, "source": old_unit, "target": product.qu_id_stock},
        )
        if raw_factor is None and await self.session.scalar(
            select(StockLog.id).where(StockLog.product_id == product.id).limit(1)
        ):
            raise GrocyError(
                "The stock unit requires a conversion after the first stock booking",
                code="missing_conversion",
            )
        factor = Decimal(str(raw_factor)) if raw_factor is not None else Decimal("1")
        for model, field in (
            (Chore, "product_amount"),
            (MealPlanEntry, "product_amount"),
            (RecipePosition, "amount"),
            (ShoppingListItem, "amount"),
            (StockEntry, "amount"),
            (StockLog, "amount"),
        ):
            values = {field: getattr(model, field) * factor}
            if model in (StockEntry, StockLog):
                values["price"] = model.price / factor
            await self.session.execute(
                update(model).where(model.product_id == product.id).values(**values)
            )
        # Local undo snapshots must use the same unit as their booking.
        logs = (
            await self.session.scalars(select(StockLog).where(StockLog.product_id == product.id))
        ).all()
        for log in logs:
            if not log.undo_data:
                continue
            data = json.loads(log.undo_data)
            for name in ("before", "after"):
                entry = data.get(name)
                if not entry:
                    continue
                entry["amount"] = float(Decimal(str(entry["amount"])) * factor)
                if entry.get("price") is not None:
                    entry["price"] = float(Decimal(str(entry["price"])) / factor)
            log.undo_data = json.dumps(data)
        for field in ("quick_consume_amount", "quick_open_amount", "tare_weight"):
            setattr(product, field, getattr(product, field) * factor)
        if product.calories is not None:
            product.calories = float(Decimal(str(product.calories)) / factor)
        await self.session.execute(
            update(CachedAveragePrice)
            .where(CachedAveragePrice.product_id == product.id)
            .values(price=CachedAveragePrice.price / factor)
        )
        await self.session.execute(
            update(CachedLastPurchase)
            .where(CachedLastPurchase.product_id == product.id)
            .values(
                amount=CachedLastPurchase.amount * factor, price=CachedLastPurchase.price / factor
            )
        )

    async def delete(self, entity: str, row) -> None:
        object_id = row.id
        if isinstance(row, Product):
            # Remove extension references before the core product records.
            nutrition_ids = select(ProductNutrition.id).where(
                ProductNutrition.product_id == object_id
            )
            await self.session.execute(
                delete(NutritionProposal).where(NutritionProposal.product_id == object_id)
            )
            await self.session.execute(
                delete(NutritionRevision).where(NutritionRevision.product_id == object_id)
            )
            await self.session.execute(
                delete(NutritionEvidence).where(NutritionEvidence.nutrition_id.in_(nutrition_ids))
            )
            await self.session.execute(
                delete(ProductNutrition).where(ProductNutrition.product_id == object_id)
            )
            for model in (
                StockEntry,
                StockLog,
                ProductBarcode,
                QuantityUnitConversion,
                RecipePosition,
                ShoppingListItem,
                CachedAveragePrice,
                CachedLastPurchase,
            ):
                await self.session.execute(delete(model).where(model.product_id == object_id))
            await self.session.execute(
                update(Recipe).where(Recipe.product_id == object_id).values(product_id=None)
            )
            await self.session.execute(
                update(Product)
                .where(Product.parent_product_id == object_id)
                .values(parent_product_id=None)
            )
            await self.session.execute(
                update(Chore)
                .where(Chore.product_id == object_id)
                .values(product_id=None, consume_product_on_execution=0)
            )
            meals = (
                await self.session.scalars(
                    select(MealPlanEntry).where(MealPlanEntry.product_id == object_id)
                )
            ).all()
            for meal in meals:
                await self.delete("meal_plan", meal)
        elif isinstance(row, Recipe):
            meals = (
                await self.session.scalars(
                    select(MealPlanEntry).where(MealPlanEntry.recipe_id == object_id)
                )
            ).all()
            for meal in meals:
                await self.delete("meal_plan", meal)
            await self.session.execute(
                delete(RecipeNesting).where(
                    (RecipeNesting.recipe_id == object_id)
                    | (RecipeNesting.includes_recipe_id == object_id)
                )
            )
            await self.session.execute(
                delete(RecipePosition).where(RecipePosition.recipe_id == object_id)
            )
            await self.session.execute(
                update(StockLog).where(StockLog.recipe_id == object_id).values(recipe_id=None)
            )
        elif isinstance(row, Chore):
            await self.session.execute(delete(ChoreLog).where(ChoreLog.chore_id == object_id))
        elif isinstance(row, Battery):
            await self.session.execute(
                delete(BatteryChargeCycle).where(BatteryChargeCycle.battery_id == object_id)
            )
        elif isinstance(row, ShoppingList):
            await self.session.execute(
                delete(ShoppingListItem).where(ShoppingListItem.shopping_list_id == object_id)
            )
        elif isinstance(row, QuantityUnitConversion):
            await self.session.execute(
                delete(QuantityUnitConversion).where(
                    QuantityUnitConversion.from_qu_id == row.to_qu_id,
                    QuantityUnitConversion.to_qu_id == row.from_qu_id,
                    QuantityUnitConversion.product_id == row.product_id,
                )
            )
        elif isinstance(row, QuantityUnit):
            await self.session.execute(
                delete(QuantityUnitConversion).where(
                    (QuantityUnitConversion.from_qu_id == object_id)
                    | (QuantityUnitConversion.to_qu_id == object_id)
                )
            )
        elif isinstance(row, UserfieldDefinition):
            await self.session.execute(
                delete(UserfieldValue).where(
                    UserfieldValue.entity == row.entity, UserfieldValue.name == row.name
                )
            )
        elif isinstance(row, UserEntity):
            for record in (
                await self.session.scalars(
                    select(UserObject).where(UserObject.userentity_id == object_id)
                )
            ).all():
                await self.delete("userobjects", record)
            fields = (
                await self.session.scalars(
                    select(UserfieldDefinition).where(
                        UserfieldDefinition.entity == f"userentity-{row.name}"
                    )
                )
            ).all()
            for field in fields:
                await self.delete("userfields", field)
        if isinstance(row, UserObject):
            definition = await self.session.get(UserEntity, row.userentity_id)
            if definition:
                await self.session.execute(
                    delete(UserfieldValue).where(
                        UserfieldValue.entity == f"userentity-{definition.name}",
                        UserfieldValue.object_id == object_id,
                    )
                )
        await self.session.execute(
            delete(UserfieldValue).where(
                UserfieldValue.entity == entity, UserfieldValue.object_id == object_id
            )
        )
        # Bulk delete avoids ORM attempts to null non-nullable child references.
        await self.session.execute(delete(type(row)).where(type(row).id == object_id))
        if isinstance(row, MealPlanEntry):
            from grocy.domains.recipes.mealplan import sync_meal_plan_recipes

            await sync_meal_plan_recipes(self.session, row.day)
