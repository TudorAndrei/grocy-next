"""Add the pinned recipe fulfillment read models."""

from alembic import op

from grocy.db.compatibility_views import install_compatibility_views

revision = "20261015_0010"
down_revision = "20261015_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    install_compatibility_views(op.get_bind())
    op.execute("""
        INSERT INTO quantity_unit_conversions
            (from_qu_id, to_qu_id, factor, product_id, row_created_timestamp)
        SELECT conversion.to_qu_id, conversion.from_qu_id,
               1.0 / conversion.factor, conversion.product_id, datetime('now', 'localtime')
        FROM quantity_unit_conversions AS conversion
        WHERE conversion.factor > 0 AND NOT EXISTS (
            SELECT 1 FROM quantity_unit_conversions AS inverse
            WHERE inverse.from_qu_id = conversion.to_qu_id
              AND inverse.to_qu_id = conversion.from_qu_id
              AND inverse.product_id IS conversion.product_id
        )
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS recipes_resolved")
    op.execute("DROP VIEW IF EXISTS recipes_missing_product_counts")
