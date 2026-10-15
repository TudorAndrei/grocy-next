"""Use Grocy allocation counters for all remaining modeled native tables."""

from alembic import op
from sqlalchemy import CheckConstraint, inspect

revision = "20261015_0014"
down_revision = "20261015_0013"
branch_labels = None
depends_on = None

# These modeled tables use AUTOINCREMENT in the pinned Grocy 4.5.0 database.
_TABLES = (
    "api_keys",
    "batteries",
    "battery_charge_cycles",
    "cache__products_average_price",
    "cache__products_last_purchased",
    "chores",
    "chores_log",
    "equipment",
    "locations",
    "meal_plan",
    "meal_plan_sections",
    "product_barcodes",
    "product_groups",
    "products",
    "quantity_unit_conversions",
    "quantity_units",
    "recipes",
    "recipes_nestings",
    "recipes_pos",
    "shopping_list",
    "shopping_lists",
    "shopping_locations",
    "stock",
    "stock_log",
    "task_categories",
    "tasks",
    "user_settings",
    "userentities",
    "userfield_values",
    "userfields",
    "userobjects",
)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    schema = dict(
        bind.exec_driver_sql("SELECT name,sql FROM sqlite_master WHERE type='table'").all()
    )
    changes = [
        name for name in _TABLES if name in schema and "AUTOINCREMENT" not in schema[name].upper()
    ]
    if not changes:
        return
    sequences = (
        dict(bind.exec_driver_sql("SELECT name,seq FROM sqlite_sequence").all())
        if "sqlite_sequence" in schema
        else {}
    )
    views = list(
        bind.exec_driver_sql("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY rowid")
    )
    triggers = list(
        bind.exec_driver_sql(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY rowid"
        )
    )
    # A trigger on another table can also refer to a table being rebuilt.
    for name, _statement in triggers:
        bind.exec_driver_sql(f"DROP TRIGGER {_quote(name)}")
    for name, _statement in views:
        bind.exec_driver_sql(f"DROP VIEW {_quote(name)}")
    for name in changes:
        checks = [
            CheckConstraint(check["sqltext"])
            for check in inspect(bind).get_check_constraints(name)
            if check["name"] is None
        ]
        with op.batch_alter_table(
            name,
            recreate="always",
            table_kwargs={"sqlite_autoincrement": True},
            table_args=tuple(checks),
        ):
            pass
        if name in sequences:
            bind.exec_driver_sql(
                "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?", (sequences[name], name)
            )
            bind.exec_driver_sql(
                "INSERT INTO sqlite_sequence (name,seq) SELECT ?,? "
                "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (name, sequences[name], name),
            )
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for _name, statement in triggers:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    # Keep counters to prevent reuse of IDs from deleted records.
    pass
