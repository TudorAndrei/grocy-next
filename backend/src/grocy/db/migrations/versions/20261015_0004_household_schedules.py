"""Complete household schedules and execution records."""

from alembic import op
from sqlalchemy import Column, DateTime, Integer, Numeric, inspect

revision = "20261015_0004"
down_revision = "20261015_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    additions = {
        "chores": [
            Column("period_interval", Integer, nullable=False, server_default="1"),
            Column("active", Integer, nullable=False, server_default="1"),
            Column("consume_product_on_execution", Integer, nullable=False, server_default="0"),
            Column("product_id", Integer),
            Column("product_amount", Numeric(15, 6)),
        ],
        "chores_log": [Column("scheduled_execution_time", DateTime)],
        "batteries": [Column("active", Integer, nullable=False, server_default="1")],
        "task_categories": [Column("active", Integer, nullable=False, server_default="1")],
    }
    bind = op.get_bind()
    old_chore_columns = {column["name"] for column in inspect(bind).get_columns("chores")}
    for table, columns in additions.items():
        existing = {column["name"] for column in inspect(bind).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)

    if "period_interval" not in old_chore_columns:
        op.execute(
            "UPDATE chores SET period_interval = "
            "CASE WHEN period_days > 0 THEN period_days ELSE 1 END "
            "WHERE period_type IN ('hourly', 'daily')"
        )


def downgrade() -> None:
    for table, names in {
        "chores": [
            "period_interval",
            "active",
            "consume_product_on_execution",
            "product_id",
            "product_amount",
        ],
        "chores_log": ["scheduled_execution_time"],
        "batteries": ["active"],
        "task_categories": ["active"],
    }.items():
        with op.batch_alter_table(table) as batch:
            for name in names:
                batch.drop_column(name)
