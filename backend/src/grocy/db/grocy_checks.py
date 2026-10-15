"""Frozen check expressions from Grocy 4.5.0, commit 21aa5eab218c8466f90729154cb293fffbe10c21.

Keep these expressions unchanged: migrations also use this pinned contract.
"""

from sqlalchemy import CheckConstraint

GROCY_450_CHECKS: dict[str, tuple[str, ...]] = {
    "batteries": ("active IN (0, 1)",),
    "battery_charge_cycles": ("undone IN (0, 1)",),
    "chores": ("period_interval > 0", "active IN (0, 1)"),
    "chores_log": ("undone IN (0, 1)", "skipped IN (0, 1)"),
    "locations": ("active IN (0, 1)",),
    "meal_plan": ("done IN (0, 1)",),
    "product_groups": ("active IN (0, 1)",),
    "products": (
        "active IN (0, 1)",
        "due_type IN (1, 2)",
        "hide_on_stock_overview IN (0, 1)",
        "should_not_be_frozen IN (0, 1)",
        "treat_opened_as_out_of_stock IN (0, 1)",
        "no_own_stock IN (0, 1)",
        "move_on_open IN (0, 1)",
        "auto_reprint_stock_label IN (0, 1)",
        "disable_open IN (0, 1)",
        "default_purchase_price_type IN (1, 2, 3)",
    ),
    "quantity_units": ("active IN (0, 1)",),
    "recipes_pos": ("round_up IN (0, 1)",),
    "shopping_locations": ("active IN (0, 1)",),
    "stock": ("open IN (0, 1)",),
    "stock_log": ("undone IN (0, 1)",),
    "task_categories": ("active IN (0, 1)",),
    "tasks": ("done IN (0, 1)",),
    "userfields": ("input_required IN (0, 1)",),
}


def native_checks(table: str) -> tuple[CheckConstraint, ...]:
    return tuple(CheckConstraint(expression) for expression in GROCY_450_CHECKS[table])
