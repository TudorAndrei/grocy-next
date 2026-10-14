from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.actor import Actor
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
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
        stmt = (
            select(Recipe)
            .options(selectinload(Recipe.positions))
            .order_by(Recipe.name)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get(self, recipe_id: int) -> Recipe:
        stmt = (
            select(Recipe)
            .options(selectinload(Recipe.positions))
            .where(Recipe.id == recipe_id)
        )
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
        recipe = Recipe(
            name=name,
            description=description,
            base_servings=base_servings,
            desired_servings=base_servings,
        )
        self.session.add(recipe)
        await self.session.flush()
        for pos in positions or []:
            self.session.add(
                RecipePosition(
                    recipe_id=recipe.id,
                    product_id=int(pos["product_id"]),
                    amount=Decimal(str(pos["amount"])),
                    qu_id=int(pos["qu_id"]),
                    note=pos.get("note"),
                    ingredient_group=pos.get("ingredient_group"),
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
        missing = 0
        need_fulfilled = True
        costs = Decimal("0")
        details: list[dict] = []
        for pos in await self._expanded_positions(recipe, scale):
            available = await self.products.stock_amount(pos["product_id"])
            needed = pos["amount"]
            ok = available >= needed or bool(pos["not_check_stock_fulfillment"])
            if not ok:
                need_fulfilled = False
                missing += 1
            details.append(
                {
                    "product_id": pos["product_id"],
                    "amount_needed": float(needed),
                    "amount_available": float(available),
                    "qu_id": pos["qu_id"],
                    "fulfilled": ok,
                }
            )
        shopping = await self.shopping.get_list(1)
        shopping_product_ids = {
            item["product_id"] for item in shopping["items"] if item["product_id"]
        }
        missing_with_list = 0
        for detail in details:
            if detail["fulfilled"]:
                continue
            if detail["product_id"] in shopping_product_ids:
                continue
            missing_with_list += 1
        return {
            "recipe_id": recipe.id,
            "need_fulfilled": need_fulfilled,
            "need_fulfilled_with_shopping_list": missing_with_list == 0,
            "missing_products_count": missing,
            "costs": float(costs),
            "positions": details,
        }

    async def consume(
        self,
        actor: Actor,
        recipe_id: int,
        *,
        servings: Decimal | None = None,
    ) -> dict:
        recipe = await self.get(recipe_id)
        if recipe.not_check_stock_fulfillment:
            pass
        else:
            status = await self.fulfillment(recipe_id, servings=servings)
            if not status["need_fulfilled"]:
                raise GrocyError(
                    "recipe stock not fulfilled",
                    code="recipe_not_fulfilled",
                )
        scale = self._scale(recipe, servings)
        bookings: list[dict] = []
        for pos in await self._expanded_positions(recipe, scale):
            amount = pos["amount"]
            if amount <= 0:
                continue
            stock_amount = amount
            if pos["qu_id"] != (await self.products.get(pos["product_id"])).qu_id_stock:
                stock_amount = await self.units.convert(
                    amount,
                    pos["qu_id"],
                    (await self.products.get(pos["product_id"])).qu_id_stock,
                    product_id=pos["product_id"],
                )
            booking = await self.stock.consume(actor, pos["product_id"], stock_amount)
            bookings.append(booking)
        return {
            "recipe_id": recipe_id,
            "servings": float(servings or recipe.desired_servings),
            "bookings": bookings,
        }

    async def add_missing_to_shopping_list(
        self,
        recipe_id: int,
        *,
        servings: Decimal | None = None,
        shopping_list_id: int = 1,
    ) -> dict:
        status = await self.fulfillment(recipe_id, servings=servings)
        added: list[dict] = []
        for pos in status["positions"]:
            if pos["fulfilled"]:
                continue
            needed = Decimal(str(pos["amount_needed"])) - Decimal(str(pos["amount_available"]))
            if needed <= 0:
                continue
            item = await self.shopping.add_item(
                pos["product_id"],
                needed,
                shopping_list_id=shopping_list_id,
                note=f"recipe:{recipe_id}",
            )
            added.append(item)
        return {"recipe_id": recipe_id, "added": added}

    async def copy(self, recipe_id: int) -> Recipe:
        recipe = await self.get(recipe_id)
        nestings = (
            await self.session.execute(
                select(RecipeNesting).where(RecipeNesting.recipe_id == recipe_id)
            )
        ).scalars().all()
        clone = Recipe(
            name=f"{recipe.name} (copy)",
            description=recipe.description,
            base_servings=recipe.base_servings,
            desired_servings=recipe.desired_servings,
            type=recipe.type,
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
            "not_check_stock_fulfillment": bool(recipe.not_check_stock_fulfillment),
            "positions": [
                {
                    "id": pos.id,
                    "product_id": pos.product_id,
                    "amount": float(pos.amount),
                    "qu_id": pos.qu_id,
                    "note": pos.note,
                    "ingredient_group": pos.ingredient_group,
                }
                for pos in recipe.positions
            ],
        }

    def _scale(self, recipe: Recipe, servings: Decimal | None) -> Decimal:
        target = servings if servings is not None else Decimal(recipe.desired_servings)
        base = Decimal(recipe.base_servings) or Decimal("1")
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
                    "not_check_stock_fulfillment": bool(
                        pos.not_check_stock_fulfillment or recipe.not_check_stock_fulfillment
                    ),
                }
            )
        nestings = (
            await self.session.execute(
                select(RecipeNesting).where(RecipeNesting.recipe_id == recipe.id)
            )
        ).scalars().all()
        for nesting in nestings:
            child = await self.get(nesting.includes_recipe_id)
            child_scale = scale * (
                Decimal(nesting.servings) / (Decimal(child.base_servings) or Decimal("1"))
            )
            await self._collect_positions(child, child_scale, out, stack=stack)
        stack.remove(recipe.id)
