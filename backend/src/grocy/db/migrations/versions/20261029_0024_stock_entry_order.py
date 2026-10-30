"""Restore the native stock scan index used by stock entry table ordering."""

from alembic import op

revision = "20261029_0024"
down_revision = "20261016_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_stock_performance1
        ON stock(product_id, open, best_before_date, amount)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_stock_performance1")
