"""Recipe cards from the pinned controller's read rules."""

import re
from typing import Any

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import empty
from grocy.compatibility.sanitizer import render_html
from grocy.core.errors import NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries


class RecipeIngredient(BaseModel):
    id: int
    product_id: int
    product_name: str
    product_id_effective: int
    active: bool
    due_score: int | None
    amount: float
    qu_id: int | None
    stock_amount: float
    missing_amount: float
    shopping_amount: float
    fulfilled: bool
    fulfilled_with_shopping_list: bool
    ingredient_group: str | None
    product_group: str | None
    variable_amount: str | None
    note_html: str
    costs: float
    calories: float


class RecipeCard(BaseModel):
    id: int
    name: str
    desired_servings: float
    picture_file_name: str | None
    preparation_html: str
    costs: float
    calories: float
    prices_incomplete: bool
    need_fulfilled_with_shopping_list: bool
    ingredients: list[RecipeIngredient]


class RecipeView(BaseModel):
    recipe_id: int
    need_fulfilled: bool
    need_fulfilled_with_shopping_list: bool
    missing_products_count: int
    cards: list[RecipeCard]


async def recipe_view(session: AsyncSession, recipe_id: int) -> RecipeView:
    await configure_compatibility_queries(session)

    async def rows(statement: str, **parameters: Any) -> list[dict[str, Any]]:
        return [
            dict(row) for row in (await session.execute(text(statement), parameters)).mappings()
        ]

    recipes = await rows(
        "SELECT * FROM recipes WHERE id=:id OR id IN "
        "(SELECT includes_recipe_id FROM recipes_nestings_resolved WHERE recipe_id=:id) "
        "ORDER BY CASE WHEN id=:id THEN 0 ELSE 1 END, name COLLATE NOCASE",
        id=recipe_id,
    )
    if not recipes or recipes[0]["id"] != recipe_id:
        raise NotFoundError("Recipe not found")
    root_positions = await rows(
        "SELECT * FROM recipes_pos_resolved WHERE recipe_id=:id", id=recipe_id
    )
    first_positions = {}
    nested_positions = {}
    for position in root_positions:
        first_positions.setdefault(position["recipe_pos_id"], position)
        if position["is_nested_recipe_pos"]:
            nested_positions.setdefault(position["recipe_pos_id"], position)

    conversions: dict[tuple[int, int, int], float] = {}
    for conversion in await rows("SELECT * FROM cache__quantity_unit_conversions_resolved"):
        conversions.setdefault(
            (conversion["product_id"], conversion["from_qu_id"], conversion["to_qu_id"]),
            float(conversion["factor"]),
        )
    products = {row["id"]: row for row in await rows("SELECT id,qu_id_stock FROM products")}
    summaries = {row["recipe_id"]: row for row in await rows("SELECT * FROM recipes_resolved")}
    cards = []
    for recipe in recipes:
        positions = await rows(
            "SELECT * FROM recipes_pos_resolved WHERE recipe_id=:id AND is_nested_recipe_pos=0 "
            "ORDER BY ingredient_group, product_group",
            id=recipe["id"],
        )
        ingredients = []
        for position in positions:
            selected = position
            if recipe["id"] != recipe_id:
                selected = nested_positions[position["recipe_pos_id"]]
            amount = selected["recipe_amount"]
            stock_unit = products[position["product_id"]]["qu_id_stock"]
            if not position["only_check_single_unit_in_stock"]:
                amount *= float(
                    conversions.get((position["product_id"], stock_unit, position["qu_id"]), 1)
                )
            status = first_positions[position["recipe_pos_id"]]
            note = re.sub(r"\r\n|\n\r|\r|\n", "<br>", position["note"] or "")
            ingredients.append(
                RecipeIngredient(
                    id=position["recipe_pos_id"],
                    product_id=position["product_id"],
                    product_name=position["product_name"],
                    product_id_effective=position["product_id_effective"],
                    active=bool(position["product_active"]),
                    due_score=position["due_score"],
                    amount=amount,
                    qu_id=position["qu_id"],
                    stock_amount=position["stock_amount"],
                    missing_amount=selected["missing_amount"],
                    shopping_amount=position["amount_on_shopping_list"],
                    fulfilled=bool(status["need_fulfilled"]),
                    fulfilled_with_shopping_list=bool(status["need_fulfilled_with_shopping_list"]),
                    ingredient_group=position["ingredient_group"],
                    product_group=position["product_group"],
                    variable_amount=None
                    if empty(position["recipe_variable_amount"])
                    else position["recipe_variable_amount"],
                    note_html=render_html(note),
                    costs=position["costs"] or 0,
                    calories=position["calories"] or 0,
                )
            )
        summary = summaries[recipe["id"]]
        cards.append(
            RecipeCard(
                id=recipe["id"],
                name=recipe["name"],
                desired_servings=recipe["desired_servings"],
                picture_file_name=recipe["picture_file_name"],
                preparation_html=render_html(recipe["description"] or ""),
                costs=summary["costs"] or 0,
                calories=summary["calories"] or 0,
                prices_incomplete=bool(summary["prices_incomplete"]),
                need_fulfilled_with_shopping_list=bool(
                    summary["need_fulfilled_with_shopping_list"]
                ),
                ingredients=ingredients,
            )
        )
    summary = summaries[recipe_id]
    return RecipeView(
        recipe_id=recipe_id,
        need_fulfilled=bool(summary["need_fulfilled"]),
        need_fulfilled_with_shopping_list=bool(summary["need_fulfilled_with_shopping_list"]),
        missing_products_count=summary["missing_products_count"],
        cards=cards,
    )
