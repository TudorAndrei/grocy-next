"""Restore native stock-log indexes and equal-timestamp journal source order."""

from alembic import op

revision = "20261029_0025"
down_revision = "20261029_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_stock_log_performance1
        ON stock_log(stock_id, transaction_type, amount)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_stock_log_performance2
        ON stock_log(
            product_id, best_before_date, purchased_date, transaction_type, stock_id, undone
        )
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_stock_log_performance2")
    op.execute("DROP INDEX IF EXISTS ix_stock_log_performance1")
