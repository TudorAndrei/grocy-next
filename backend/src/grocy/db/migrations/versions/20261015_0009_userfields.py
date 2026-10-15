"""Preserve null custom field values."""

from alembic import op
from sqlalchemy import Text, inspect

revision = "20261015_0009"
down_revision = "20261015_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = inspect(op.get_bind()).get_columns("userfield_values")
    if any(column["name"] == "value" and not column["nullable"] for column in columns):
        with op.batch_alter_table("userfield_values") as batch:
            batch.alter_column("value", existing_type=Text, nullable=True)


def downgrade() -> None:
    # Preserve stored null values. Restore a database backup to remove this change.
    pass
