"""Add the Grocy index used for chore execution history."""

from alembic import op

revision = "20261015_0011"
down_revision = "20261015_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_chores_log_performance1
        ON chores_log(chore_id, undone, tracked_time)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chores_log_performance1")
