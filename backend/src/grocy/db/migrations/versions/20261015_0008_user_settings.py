"""Preserve null preferences and their update time."""

from alembic import op
from sqlalchemy import Column, DateTime, Text, inspect, text

revision = "20261015_0008"
down_revision = "20261015_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {
        column["name"]: column for column in inspect(op.get_bind()).get_columns("user_settings")
    }
    needs_timestamp = "row_updated_timestamp" not in columns
    needs_default = not needs_timestamp and not columns["row_updated_timestamp"]["default"]
    if columns["value"]["nullable"] and not needs_timestamp and not needs_default:
        return
    with op.batch_alter_table("user_settings") as batch:
        batch.alter_column("value", existing_type=Text, nullable=True)
        if needs_timestamp:
            batch.add_column(
                Column(
                    "row_updated_timestamp",
                    DateTime,
                    nullable=True,
                    server_default=text("(datetime('now', 'localtime'))"),
                )
            )
        elif needs_default:
            batch.alter_column(
                "row_updated_timestamp",
                existing_type=DateTime,
                server_default=text("(datetime('now', 'localtime'))"),
            )


def downgrade() -> None:
    # Keep null preferences. Restore a database backup to remove these fields.
    pass
