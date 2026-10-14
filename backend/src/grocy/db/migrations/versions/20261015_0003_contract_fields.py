"""Add custom entities and fields from the Grocy contract."""

from datetime import UTC, datetime

from alembic import op
from sqlalchemy import Column, DateTime, inspect, text
from sqlalchemy.schema import ColumnDefault

revision = "20261015_0003"
down_revision = "20261015_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from grocy.db.models import Base

    bind = op.get_bind()
    if inspect(bind).has_table("recipes") and any(
        constraint["column_names"] == ["name"]
        for constraint in inspect(bind).get_unique_constraints("recipes")
    ):
        with op.batch_alter_table(
            "recipes", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}
        ) as batch:
            batch.drop_constraint("uq_recipes_name", type_="unique")
    for table in Base.metadata.sorted_tables:
        if not inspect(bind).has_table(table.name):
            table.create(bind)
            continue
        columns = {column["name"] for column in inspect(bind).get_columns(table.name)}
        for column in table.columns:
            if column.name in columns:
                continue
            default = None
            if not column.nullable and isinstance(column.type, DateTime):
                default = text(
                    "'" + datetime.now(UTC).replace(tzinfo=None).isoformat(sep=" ") + "'"
                )
            if not column.nullable and isinstance(column.default, ColumnDefault):
                value = column.default.arg
                default = (
                    text(str(value))
                    if isinstance(value, (int, float))
                    else text("'" + str(value).replace("'", "''") + "'")
                )
            op.add_column(
                table.name,
                Column(column.name, column.type, nullable=column.nullable, server_default=default),
            )


def downgrade() -> None:
    # Keep user data when reverting application code. Restore a database backup to remove fields.
    pass
