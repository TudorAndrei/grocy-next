"""Keep ORM links without the extra foreign keys absent from Grocy 4.5.0.

This frozen list also identifies the project constraints removed by revision 0016.
Nutrition and custom database references are outside this list.
"""

from typing import Any

from sqlalchemy import MetaData

GROCY_450_REFERENCES = {
    "products": {
        "default_consume_location_id": "locations.id",
        "location_id": "locations.id",
        "parent_product_id": "products.id",
        "product_group_id": "product_groups.id",
        "qu_id_consume": "quantity_units.id",
        "qu_id_price": "quantity_units.id",
        "qu_id_purchase": "quantity_units.id",
        "qu_id_stock": "quantity_units.id",
    },
    "product_barcodes": {"product_id": "products.id", "qu_id": "quantity_units.id"},
    "chores": {"product_id": "products.id"},
    "chores_log": {"chore_id": "chores.id"},
    "tasks": {"category_id": "task_categories.id"},
    "battery_charge_cycles": {"battery_id": "batteries.id"},
    "meal_plan": {
        "product_id": "products.id",
        "product_qu_id": "quantity_units.id",
        "recipe_id": "recipes.id",
        "section_id": "meal_plan_sections.id",
    },
    "recipes": {"product_id": "products.id"},
    "recipes_pos": {
        "product_id": "products.id",
        "qu_id": "quantity_units.id",
        "recipe_id": "recipes.id",
    },
    "recipes_nestings": {"includes_recipe_id": "recipes.id", "recipe_id": "recipes.id"},
    "userobjects": {"userentity_id": "userentities.id"},
    "shopping_list": {
        "product_id": "products.id",
        "qu_id": "quantity_units.id",
        "shopping_list_id": "shopping_lists.id",
    },
    "stock": {"location_id": "locations.id", "product_id": "products.id"},
    "stock_log": {
        "location_id": "locations.id",
        "product_id": "products.id",
        "recipe_id": "recipes.id",
    },
    "quantity_unit_conversions": {
        "from_qu_id": "quantity_units.id",
        "product_id": "products.id",
        "to_qu_id": "quantity_units.id",
    },
}


def _omit_database_constraint(*_args: Any, **_kwargs: Any) -> bool:
    return False


def configure_native_references(metadata: MetaData) -> None:
    for name, references in GROCY_450_REFERENCES.items():
        table = metadata.tables[name]
        for constraint in table.foreign_key_constraints:
            if len(constraint.elements) == 1:
                link = constraint.elements[0]
                if references.get(link.parent.name) == link.target_fullname:
                    constraint.ddl_if(callable_=_omit_database_constraint)
