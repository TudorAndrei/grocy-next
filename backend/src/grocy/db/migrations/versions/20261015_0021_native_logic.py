"""Run native catalog, cache, and meal plan triggers in their source order."""

from alembic import op
from sqlalchemy import inspect

from grocy.db.compatibility_views import register_compatibility_functions
from grocy.db.native_schema import SCHEMA, install_native_logic

revision = "20261015_0021"
down_revision = "20261015_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    register_compatibility_functions(bind)
    existing = set(inspect(bind).get_table_names())
    for name, statement in SCHEMA["ddl"].items():
        if name not in existing:
            bind.exec_driver_sql(statement)
    if "permission_hierarchy" not in existing:
        for row in SCHEMA["permissions"]:
            bind.exec_driver_sql(
                "INSERT INTO permission_hierarchy(id,name,parent) VALUES (?,?,?)", tuple(row)
            )
    install_native_logic(bind)
    if "cache__quantity_unit_conversions_resolved" not in existing:
        bind.exec_driver_sql(
            "INSERT INTO cache__quantity_unit_conversions_resolved "
            "(product_id,from_qu_id,from_qu_name,from_qu_name_plural,to_qu_id,"
            "to_qu_name,to_qu_name_plural,factor,path) "
            "SELECT product_id,from_qu_id,from_qu_name,from_qu_name_plural,to_qu_id,"
            "to_qu_name,to_qu_name_plural,factor,path FROM quantity_unit_conversions_resolved"
        )
    # Early project revisions did not persist the native internal recipes.
    # Repair those missing records once. Normal startup must not rebuild them.
    missing = (
        bind.exec_driver_sql("""
        SELECT id FROM meal_plan m
        WHERE NOT EXISTS (SELECT 1 FROM recipes WHERE type='mealplan-day' AND name=m.day)
        OR NOT EXISTS (SELECT 1 FROM recipes WHERE type='mealplan-week'
                       AND name=LTRIM(STRFTIME('%Y-%W',m.day),'0'))
        OR (m.type='recipe' AND m.recipe_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM recipes WHERE type='mealplan-shadow' AND name=m.day || '#' || m.id
        ))
    """)
        .scalars()
        .all()
    )
    for row_id in missing:
        bind.exec_driver_sql("UPDATE meal_plan SET day=day WHERE id=?", (row_id,))


def downgrade() -> None:
    # Keep persisted native records and allocation counters.
    pass
