"""Restore native catalog, household, recipe, and unit-cache indexes."""

from alembic import op

revision = "20261029_0026"
down_revision = "20261029_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_products_performance1 ON products(parent_product_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_products_performance2 ON products(
            CASE WHEN parent_product_id IS NULL THEN id ELSE parent_product_id END, active
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_recipes ON recipes(name, type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_chores_performance1 ON chores(id, active)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_batteries_performance1 ON batteries(id, active)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_cache__quantity_unit_conversions_resolved_performance1
        ON cache__quantity_unit_conversions_resolved(product_id, from_qu_id, to_qu_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_cache__quantity_unit_conversions_resolved_performance1")
    op.execute("DROP INDEX IF EXISTS ix_batteries_performance1")
    op.execute("DROP INDEX IF EXISTS ix_chores_performance1")
    op.execute("DROP INDEX IF EXISTS ix_recipes")
    op.execute("DROP INDEX IF EXISTS ix_products_performance2")
    op.execute("DROP INDEX IF EXISTS ix_products_performance1")
