from __future__ import annotations

import uuid
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.actor import Actor
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
from grocy.db.models.shopping import ShoppingListItem
from grocy.db.types import database_time
from grocy.domains.products.service import ProductsService
from grocy.domains.shopping.service import ShoppingService
from grocy.domains.stock.service import StockService
from grocy.domains.units.service import UnitsService


class RecipesService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.products = ProductsService(session)
        self.units = UnitsService(session)
        self.stock = StockService(session)
        self.shopping = ShoppingService(session)

    async def list_recipes(self) -> list[Recipe]:
        stmt = select(Recipe).options(selectinload(Recipe.positions)).order_by(Recipe.name)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get(self, recipe_id: int) -> Recipe:
        stmt = select(Recipe).options(selectinload(Recipe.positions)).where(Recipe.id == recipe_id)
        recipe = (await self.session.execute(stmt)).scalars().first()
        if recipe is None:
            raise NotFoundError(f"Recipe {recipe_id} not found")
        return recipe

    async def create(
        self,
        name: str,
        *,
        description: str | None = None,
        base_servings: Decimal = Decimal("1"),
        positions: list[dict] | None = None,
    ) -> Recipe:
        if not name.strip() or base_servings <= 0:
            raise GrocyError("Name and positive servings are required")
        recipe = Recipe(
            name=name,
            description=description,
            base_servings=base_servings,
            desired_servings=base_servings,
        )
        self.session.add(recipe)
        await self.session.flush()
        for pos in positions or []:
            try:
                product = await self.products.get(int(pos["product_id"]))
                amount = Decimal(str(pos["amount"]))
                qu_id = int(pos["qu_id"])
                price_factor = Decimal(str(pos.get("price_factor", 1)))
                if not amount.is_finite() or amount <= 0:
                    raise ValueError("Invalid amount")
                if not price_factor.is_finite() or price_factor < 0:
                    raise ValueError("Invalid price factor")
                if not pos.get("only_check_single_unit_in_stock"):
                    await self.units.convert(
                        amount, qu_id, product.qu_id_stock, product_id=product.id
                    )
            except (KeyError, ValueError, TypeError) as exc:
                raise GrocyError(
                    "Ingredient requires a product, unit, and positive amount"
                ) from exc
            stored_amount = amount
            if not pos.get("only_check_single_unit_in_stock"):
                stored_amount = await self.units.convert(
                    amount, qu_id, product.qu_id_stock, product_id=product.id
                )
                qu_id = product.qu_id_stock
            self.session.add(
                RecipePosition(
                    recipe_id=recipe.id,
                    product_id=int(pos["product_id"]),
                    amount=stored_amount,
                    qu_id=qu_id,
                    note=pos.get("note"),
                    ingredient_group=pos.get("ingredient_group"),
                    only_check_single_unit_in_stock=int(
                        bool(pos.get("only_check_single_unit_in_stock"))
                    ),
                    not_check_stock_fulfillment=int(bool(pos.get("not_check_stock_fulfillment"))),
                    round_up=int(bool(pos.get("round_up"))),
                    price_factor=price_factor,
                    variable_amount=pos.get("variable_amount"),
                )
            )
        await self.session.commit()
        return await self.get(recipe.id)

    async def fulfillment(
        self,
        recipe_id: int,
        *,
        servings: Decimal | None = None,
    ) -> dict:
        recipe = await self.get(recipe_id)
        scale = self._scale(recipe, servings)
        positions = await self._stock_positions(recipe, scale)
        await configure_compatibility_queries(self.session)
        row = (
            (
                await self.session.execute(
                    text("SELECT * FROM recipes_resolved WHERE recipe_id = :recipe_id"),
                    {"recipe_id": recipe_id},
                )
            )
            .mappings()
            .one()
        )
        result = dict(row)
        details = []
        scaled_costs = Decimal("0")
        for pos in positions:
            available, price = await self._available_and_price(pos["product_id"])
            scaled_costs += pos["cost_amount"] * price
            details.append(
                {
                    "product_id": pos["product_id"],
                    "amount_needed": float(pos["amount"]),
                    "amount_available": float(available),
                    "qu_id": pos["qu_id"],
                    "fulfilled": available >= pos["check_amount"],
                }
            )
        if servings is not None:
            result["costs"] = float(scaled_costs)
            result["costs_per_serving"] = float(scaled_costs / servings)
            result["need_fulfilled"] = all(pos["fulfilled"] for pos in details)
        result["need_fulfilled"] = bool(result["need_fulfilled"])
        result["need_fulfilled_with_shopping_list"] = bool(
            result["need_fulfilled_with_shopping_list"]
        )
        result["positions"] = details
        return result

    async def consume(
        self, actor: Actor, recipe_id: int, *, servings: Decimal | None = None, commit: bool = True
    ) -> dict:
        recipe = await self.get(recipe_id)
        positions = await self._stock_positions(recipe, self._scale(recipe, servings))
        status = await self.fulfillment(recipe_id, servings=servings)
        transaction_id = uuid.uuid4().hex
        bookings = []
        try:
            for pos in positions:
                available, _price = await self._available_and_price(pos["product_id"])
                amount = min(available, pos["consume_amount"])
                if amount > 0:
                    bookings.append(
                        await self.stock.consume(
                            actor,
                            pos["product_id"],
                            amount,
                            commit=False,
                            allow_subproduct_substitution=True,
                            recipe_id=recipe_id,
                            transaction_id=transaction_id,
                        )
                    )
            source = recipe
            produced = servings if servings is not None else recipe.desired_servings
            if recipe.type == "mealplan-shadow":
                meal = await self.session.get(MealPlanEntry, int(recipe.name.rsplit("#", 1)[1]))
                if meal is None or meal.recipe_id is None:
                    raise NotFoundError("Meal plan recipe not found")
                source = await self.get(meal.recipe_id)
                produced = (
                    servings if servings is not None else meal.recipe_servings or Decimal("1")
                )
            if source.product_id:
                await self.stock.purchase(
                    actor,
                    source.product_id,
                    produced,
                    price=Decimal(str(status["costs"])) / produced,
                    transaction_type="self-production",
                    exact_amount=True,
                    note=source.name,
                    commit=False,
                )
            if commit:
                await self.session.commit()
            else:
                await self.session.flush()
        except Exception:
            await self.session.rollback()
            raise
        return {
            "recipe_id": recipe_id,
            "servings": float(servings if servings is not None else recipe.desired_servings),
            "bookings": bookings,
        }

    async def _available_and_price(self, product_id: int) -> tuple[Decimal, Decimal]:
        product = await self.products.get(product_id)
        entries = await self.stock._ordered_entries(product_id, include_sub_products=True)
        available = Decimal("0")
        for entry in entries:
            child = await self.products.get(entry.product_id)
            available += await self.units.convert(
                entry.amount, child.qu_id_stock, product.qu_id_stock, product_id=child.id
            )
        effective = product_id
        if not await self.products.stock_amount(product_id) and entries:
            effective = entries[0].product_id
        price = await self.session.scalar(
            text("SELECT price FROM products_current_price WHERE product_id = :id"),
            {"id": effective},
        )
        value = Decimal(str(price)) if price is not None else Decimal("0")
        if effective != product_id:
            child = await self.products.get(effective)
            factor = await self.units.convert(
                Decimal("1"), child.qu_id_stock, product.qu_id_stock, product_id=child.id
            )
            value /= factor
        return available, value

    async def _stock_positions(self, recipe: Recipe, scale: Decimal) -> list[dict]:
        grouped: dict[int, dict] = {}
        for pos in await self._expanded_positions(recipe, scale):
            product = await self.products.get(pos["product_id"])
            rounded = (
                pos["amount"].to_integral_value(rounding=ROUND_CEILING)
                if pos["round_up"]
                else pos["amount"]
            )
            try:
                factor = await self.units.convert(
                    Decimal("1"), pos["qu_id"], product.qu_id_stock, product_id=product.id
                )
            except GrocyError as exc:
                if not pos["only_check_single_unit_in_stock"] or exc.code != "missing_conversion":
                    raise
                factor = Decimal("1")
            if not pos["only_check_single_unit_in_stock"]:
                factor = Decimal("1")
            amount = rounded * factor
            check = (
                Decimal("0")
                if pos["not_check_stock_fulfillment"]
                or product.not_check_stock_fulfillment_for_recipes
                else amount
            )
            if pos.get("only_check_single_unit_in_stock") and check:
                check = Decimal("0.00000001")
            result = grouped.setdefault(
                product.id,
                {
                    "product_id": product.id,
                    "qu_id": product.qu_id_stock,
                    "amount": Decimal("0"),
                    "check_amount": Decimal("0"),
                    "consume_amount": Decimal("0"),
                    "cost_amount": Decimal("0"),
                },
            )
            result["amount"] += amount
            result["check_amount"] += check
            if not pos["only_check_single_unit_in_stock"]:
                result["consume_amount"] += amount
            result["cost_amount"] += pos["amount"] * factor * pos["price_factor"]
        return list(grouped.values())

    async def add_missing_to_shopping_list(
        self,
        recipe_id: int,
        *,
        servings: Decimal | None = None,
        shopping_list_id: int = 1,
        excluded_product_ids: list[int] | None = None,
    ) -> dict:
        recipe = await self.get(recipe_id)
        await self.shopping.get_list(shopping_list_id)
        positions = await self._expanded_positions(recipe, self._scale(recipe, servings))
        existing_rows = list(
            (
                await self.session.scalars(select(ShoppingListItem).order_by(ShoppingListItem.id))
            ).all()
        )
        planned: dict[int, Decimal] = {}
        for item in existing_rows:
            if item.product_id is not None:
                planned[item.product_id] = planned.get(item.product_id, Decimal("0")) + item.amount
        added: list[dict] = []
        for pos in positions:
            product = await self.products.get(pos["product_id"])
            if product.id in (excluded_product_ids or []) or pos["not_check_stock_fulfillment"]:
                continue
            available, _ = await self._available_and_price(product.id)
            amount = (
                pos["amount"].to_integral_value(rounding=ROUND_CEILING)
                if pos["round_up"]
                else pos["amount"]
            )
            if pos["only_check_single_unit_in_stock"] and available > 0:
                continue
            missing = max(Decimal("0"), amount - available)
            needed = (
                missing
                - (
                    Decimal("0")
                    if recipe.not_check_shoppinglist
                    else planned.get(product.id, Decimal("0"))
                )
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            qu_id = product.qu_id_purchase
            if pos["only_check_single_unit_in_stock"]:
                try:
                    needed = await self.units.convert(
                        needed, pos["qu_id"], product.qu_id_stock, product_id=product.id
                    )
                except GrocyError as exc:
                    if exc.code != "missing_conversion":
                        raise
                    qu_id, needed = pos["qu_id"], missing
            if needed <= 0:
                continue
            existing = next((row for row in existing_rows if row.product_id == product.id), None)
            if existing is None:
                existing = ShoppingListItem(
                    product_id=product.id,
                    amount=needed,
                    qu_id=qu_id,
                    shopping_list_id=shopping_list_id,
                )
                self.session.add(existing)
                existing_rows.append(existing)
            else:
                existing.amount += needed
            added.append({"product_id": product.id, "amount": float(needed)})
        await self.session.commit()
        return {"recipe_id": recipe_id, "added": added}

    async def copy(self, recipe_id: int) -> Recipe:
        recipe = await self.get(recipe_id)
        nestings = (
            (
                await self.session.execute(
                    select(RecipeNesting).where(RecipeNesting.recipe_id == recipe_id)
                )
            )
            .scalars()
            .all()
        )
        clone = Recipe(
            name=f"Copy of {recipe.name}",
            description=recipe.description,
            base_servings=recipe.base_servings,
            desired_servings=recipe.base_servings,
            type=recipe.type,
            picture_file_name=recipe.picture_file_name,
            not_check_shoppinglist=recipe.not_check_shoppinglist,
            product_id=recipe.product_id,
            not_check_stock_fulfillment=recipe.not_check_stock_fulfillment,
        )
        self.session.add(clone)
        await self.session.flush()
        for pos in recipe.positions:
            self.session.add(
                RecipePosition(
                    recipe_id=clone.id,
                    product_id=pos.product_id,
                    amount=pos.amount,
                    qu_id=pos.qu_id,
                    only_check_single_unit_in_stock=pos.only_check_single_unit_in_stock,
                    ingredient_group=pos.ingredient_group,
                    note=pos.note,
                    not_check_stock_fulfillment=pos.not_check_stock_fulfillment,
                    variable_amount=pos.variable_amount,
                    price_factor=pos.price_factor,
                    round_up=0,
                )
            )
        for nesting in nestings:
            self.session.add(
                RecipeNesting(
                    recipe_id=clone.id,
                    includes_recipe_id=nesting.includes_recipe_id,
                    servings=nesting.servings,
                )
            )
        await self.session.commit()
        return await self.get(clone.id)

    async def search(self, query: str, *, limit: int = 25) -> list[Recipe]:
        q = query.strip()
        if not q:
            return []
        stmt = (
            select(Recipe)
            .options(selectinload(Recipe.positions))
            .where(Recipe.name.ilike(f"%{q}%"))
            .order_by(Recipe.name)
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    def serialize(self, recipe: Recipe) -> dict:
        return {
            "id": recipe.id,
            "name": recipe.name,
            "description": recipe.description,
            "base_servings": float(recipe.base_servings),
            "desired_servings": float(recipe.desired_servings),
            "type": recipe.type,
            "picture_file_name": recipe.picture_file_name,
            "not_check_shoppinglist": recipe.not_check_shoppinglist,
            "product_id": recipe.product_id,
            "row_created_timestamp": database_time(recipe.row_created_timestamp),
            "not_check_stock_fulfillment": bool(recipe.not_check_stock_fulfillment),
            "positions": [
                {
                    "id": pos.id,
                    "product_id": pos.product_id,
                    "amount": float(pos.amount),
                    "qu_id": pos.qu_id,
                    "note": pos.note,
                    "ingredient_group": pos.ingredient_group,
                    "only_check_single_unit_in_stock": pos.only_check_single_unit_in_stock,
                    "not_check_stock_fulfillment": pos.not_check_stock_fulfillment,
                    "round_up": pos.round_up,
                    "price_factor": float(pos.price_factor),
                    "variable_amount": pos.variable_amount,
                }
                for pos in recipe.positions
            ],
        }

    def _scale(self, recipe: Recipe, servings: Decimal | None) -> Decimal:
        target = servings if servings is not None else Decimal(recipe.desired_servings)
        if target <= 0 or recipe.base_servings <= 0:
            raise GrocyError("Servings must be positive", code="invalid_amount")
        base = Decimal(recipe.base_servings)
        return target / base

    async def _expanded_positions(self, recipe: Recipe, scale: Decimal) -> list[dict]:
        positions: list[dict] = []
        await self._collect_positions(recipe, scale, positions, stack=set())
        return positions

    async def _collect_positions(
        self,
        recipe: Recipe,
        scale: Decimal,
        out: list[dict],
        *,
        stack: set[int],
    ) -> None:
        if recipe.id in stack:
            raise GrocyError("recipe nesting cycle detected", code="recipe_cycle")
        stack.add(recipe.id)
        for pos in recipe.positions:
            out.append(
                {
                    "product_id": pos.product_id,
                    "amount": Decimal(pos.amount) * scale,
                    "qu_id": pos.qu_id,
                    "round_up": bool(pos.round_up),
                    "price_factor": Decimal(pos.price_factor),
                    "only_check_single_unit_in_stock": pos.only_check_single_unit_in_stock,
                    "not_check_stock_fulfillment": bool(
                        pos.not_check_stock_fulfillment or recipe.not_check_stock_fulfillment
                    ),
                }
            )
        nestings = (
            (
                await self.session.execute(
                    select(RecipeNesting).where(RecipeNesting.recipe_id == recipe.id)
                )
            )
            .scalars()
            .all()
        )
        for nesting in nestings:
            child = await self.get(nesting.includes_recipe_id)
            child_scale = scale * (
                Decimal(nesting.servings) / (Decimal(child.base_servings) or Decimal("1"))
            )
            await self._collect_positions(child, child_scale, out, stack=stack)
        stack.remove(recipe.id)
