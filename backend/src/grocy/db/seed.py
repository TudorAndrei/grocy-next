from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.models.catalog import Location, Product, ProductBarcode, ProductGroup, QuantityUnit
from grocy.db.models.household import Battery, Chore, Task, TaskCategory
from grocy.db.models.recipes import Recipe, RecipePosition
from grocy.db.models.shopping import ShoppingList
from grocy.db.models.units import QuantityUnitConversion
from grocy.db.models.users import ApiKey, User, UserPermission
from grocy.domains.units.service import UnitsService


async def seed_if_empty(session: AsyncSession, *, api_key: str = "dev-key") -> None:
    user_count = await session.scalar(select(func.count()).select_from(User))
    if user_count and user_count > 0:
        return

    admin = User(username="admin", first_name="Admin", last_name="User", password="")
    session.add(admin)
    await session.flush()
    session.add(UserPermission(user_id=admin.id, permission_id=1))
    session.add(
        ApiKey(
            api_key=api_key,
            user_id=admin.id,
            key_type="default",
            description="Bootstrap development key",
        )
    )

    piece = QuantityUnit(name="Piece", name_plural="Pieces", description="Count")
    gram = QuantityUnit(name="Gram", name_plural="Grams", description="Mass")
    kilogram = QuantityUnit(name="Kilogram", name_plural="Kilograms", description="Mass")
    milliliter = QuantityUnit(name="Milliliter", name_plural="Milliliters", description="Volume")
    session.add_all([piece, gram, kilogram, milliliter])
    await session.flush()
    conversion = QuantityUnitConversion(
        from_qu_id=kilogram.id,
        to_qu_id=gram.id,
        factor=Decimal("1000"),
        product_id=None,
    )
    session.add(conversion)
    await session.flush()
    await UnitsService(session).sync_inverse(conversion)

    pantry = Location(name="Pantry", description="Dry goods")
    fridge = Location(name="Fridge", description="Cold storage")
    session.add_all([pantry, fridge])

    dairy = ProductGroup(name="Dairy", description="Milk products")
    session.add(dairy)
    await session.flush()

    yogurt = Product(
        name="Greek Yogurt",
        description="Plain Greek yogurt",
        location_id=fridge.id,
        qu_id_purchase=piece.id,
        qu_id_stock=piece.id,
        qu_factor_purchase_to_stock=Decimal("1"),
        product_group_id=dairy.id,
        min_stock_amount=Decimal("1"),
    )
    oats = Product(
        name="Rolled Oats",
        description="Whole grain oats",
        location_id=pantry.id,
        qu_id_purchase=gram.id,
        qu_id_stock=gram.id,
        qu_factor_purchase_to_stock=Decimal("1"),
        min_stock_amount=Decimal("500"),
    )
    milk = Product(
        name="Whole Milk",
        description="Fresh milk",
        location_id=fridge.id,
        qu_id_purchase=milliliter.id,
        qu_id_stock=milliliter.id,
        qu_factor_purchase_to_stock=Decimal("1"),
        product_group_id=dairy.id,
    )
    session.add_all([yogurt, oats, milk])
    await session.flush()
    session.add_all(
        [
            ProductBarcode(product_id=yogurt.id, barcode="4006381333931"),
            ProductBarcode(product_id=oats.id, barcode="5000159407236"),
            ProductBarcode(product_id=milk.id, barcode="3017620425035"),
        ]
    )
    session.add(ShoppingList(name="Shopping list"))

    breakfast = Recipe(
        name="Yogurt Bowl",
        description="Oats with yogurt and milk",
        base_servings=Decimal("1"),
        desired_servings=Decimal("1"),
    )
    session.add(breakfast)
    await session.flush()
    session.add_all(
        [
            RecipePosition(
                recipe_id=breakfast.id,
                product_id=yogurt.id,
                amount=Decimal("1"),
                qu_id=piece.id,
            ),
            RecipePosition(
                recipe_id=breakfast.id,
                product_id=oats.id,
                amount=Decimal("50"),
                qu_id=gram.id,
            ),
            RecipePosition(
                recipe_id=breakfast.id,
                product_id=milk.id,
                amount=Decimal("100"),
                qu_id=milliliter.id,
            ),
        ]
    )

    category = TaskCategory(name="General", description="Default")
    session.add(category)
    await session.flush()
    session.add_all(
        [
            Task(
                name="Check pantry expiry dates",
                description="Weekly scan",
                due_date=datetime.now() + timedelta(days=3),
                category_id=category.id,
                assigned_to_user_id=admin.id,
            ),
            Chore(
                name="Clean fridge",
                description="Wipe shelves",
                period_type="weekly",
                period_interval=1,
                period_config="sunday",
                start_date=datetime.now(),
            ),
            Battery(
                name="Kitchen scale",
                description="AAA pack",
                used_in="Kitchen",
                charge_interval_days=90,
            ),
        ]
    )
    await session.commit()
