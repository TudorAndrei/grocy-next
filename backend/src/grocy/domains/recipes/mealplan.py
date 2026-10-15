"""Build Grocy's day, week, and individual meal recipes from meal plan records."""

from collections import Counter
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition


async def sync_meal_plan_recipes(
    session: AsyncSession, *days: date, preserve_matching: bool = False
) -> None:
    entries = list((await session.scalars(select(MealPlanEntry).order_by(MealPlanEntry.id))).all())
    for day in set(days):
        for kind, name, meals in (
            ("mealplan-day", day.isoformat(), [row for row in entries if row.day == day]),
            (
                "mealplan-week",
                day.strftime("%Y-%W").lstrip("0"),
                [row for row in entries if row.day.strftime("%Y-%W") == day.strftime("%Y-%W")],
            ),
        ):
            recipe = await _internal_recipe(session, kind, name)
            await _replace_contents(session, recipe, meals, preserve_matching=preserve_matching)
    shadows = list(
        (await session.scalars(select(Recipe).where(Recipe.type == "mealplan-shadow"))).all()
    )
    active = {
        f"{row.day.isoformat()}#{row.id}": row
        for row in entries
        if row.type == "recipe" and row.recipe_id is not None
    }
    for shadow in shadows:
        if shadow.name not in active:
            await session.execute(delete(RecipeNesting).where(RecipeNesting.recipe_id == shadow.id))
            await session.execute(
                delete(RecipePosition).where(RecipePosition.recipe_id == shadow.id)
            )
            await session.execute(delete(Recipe).where(Recipe.id == shadow.id))
    for name, meal in active.items():
        if meal.day in days:
            shadow = await _internal_recipe(session, "mealplan-shadow", name)
            await _replace_contents(session, shadow, [meal], preserve_matching=preserve_matching)
    await session.flush()


async def _internal_recipe(session: AsyncSession, kind: str, name: str) -> Recipe:
    recipe = await session.scalar(select(Recipe).where(Recipe.type == kind, Recipe.name == name))
    if recipe is None:
        minimum = await session.scalar(select(func.min(Recipe.id)))
        recipe = Recipe(
            id=min(0, (minimum if minimum is not None else 1) - 1), name=name, type=kind
        )
        session.add(recipe)
        await session.flush()
    return recipe


async def _replace_contents(
    session: AsyncSession, recipe: Recipe, meals: list[MealPlanEntry], *, preserve_matching: bool
) -> None:
    nestings: dict[int, Decimal] = {}
    products: dict[tuple[int, int], Decimal] = {}
    for meal in meals:
        if meal.type == "recipe" and meal.recipe_id is not None:
            nestings[meal.recipe_id] = nestings.get(meal.recipe_id, Decimal("0")) + (
                meal.recipe_servings or Decimal("1")
            )
        elif (
            meal.type == "product"
            and meal.product_id is not None
            and meal.product_qu_id is not None
        ):
            key = (meal.product_id, meal.product_qu_id)
            products[key] = products.get(key, Decimal("0")) + (meal.product_amount or Decimal("0"))
    if preserve_matching:
        stored_nestings = await session.execute(
            select(RecipeNesting.includes_recipe_id, RecipeNesting.servings).where(
                RecipeNesting.recipe_id == recipe.id
            )
        )
        stored_products = await session.execute(
            select(RecipePosition.product_id, RecipePosition.qu_id, RecipePosition.amount).where(
                RecipePosition.recipe_id == recipe.id
            )
        )
        if Counter(tuple(row) for row in stored_nestings) == Counter(nestings.items()) and Counter(
            tuple(row) for row in stored_products
        ) == Counter((product, unit, amount) for (product, unit), amount in products.items()):
            return
    await session.execute(delete(RecipeNesting).where(RecipeNesting.recipe_id == recipe.id))
    await session.execute(delete(RecipePosition).where(RecipePosition.recipe_id == recipe.id))
    for recipe_id, servings in nestings.items():
        session.add(
            RecipeNesting(recipe_id=recipe.id, includes_recipe_id=recipe_id, servings=servings)
        )
    for (product_id, unit_id), amount in products.items():
        session.add(
            RecipePosition(recipe_id=recipe.id, product_id=product_id, qu_id=unit_id, amount=amount)
        )
    await session.flush()
