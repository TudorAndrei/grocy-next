"""Store the open date in stock booking history."""

from alembic import op
from sqlalchemy import Column, Date, DateTime, Integer, Numeric, inspect

revision = "20261015_0005"
down_revision = "20261015_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not inspect(op.get_bind()).has_table("cache__products_average_price"):
        op.create_table(
            "cache__products_average_price",
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("product_id", Integer, unique=True, nullable=False),
            Column("price", Numeric(15, 6)),
        )
    if not inspect(op.get_bind()).has_table("cache__products_last_purchased"):
        op.create_table(
            "cache__products_last_purchased",
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("product_id", Integer, unique=True, nullable=False),
            Column("amount", Numeric(15, 6)),
            Column("best_before_date", Date),
            Column("purchased_date", Date),
            Column("price", Numeric(15, 6)),
            Column("location_id", Integer),
            Column("shopping_location_id", Integer),
        )
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("stock_log")}
    if "opened_date" not in columns:
        op.add_column("stock_log", Column("opened_date", DateTime))


def downgrade() -> None:
    op.drop_table("cache__products_average_price")
    op.drop_table("cache__products_last_purchased")
    with op.batch_alter_table("stock_log") as batch:
        batch.drop_column("opened_date")
