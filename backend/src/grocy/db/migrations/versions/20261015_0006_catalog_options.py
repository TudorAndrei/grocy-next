"""Keep the remaining Grocy catalog options in active records."""

from alembic import op
from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text, inspect

revision = "20261015_0006"
down_revision = "20261015_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    additions = {
        "products": [
            Column(
                "default_best_before_days_after_freezing",
                Integer,
                nullable=False,
                server_default="0",
            ),
            Column(
                "default_best_before_days_after_thawing",
                Integer,
                nullable=False,
                server_default="0",
            ),
            Column("calories", Integer, nullable=True),
            Column(
                "cumulate_min_stock_amount_of_sub_products",
                Integer,
                nullable=False,
                server_default="0",
            ),
            Column("due_type", Integer, nullable=False, server_default="1"),
            Column("quick_consume_amount", Numeric(15, 6), nullable=False, server_default="1"),
            Column("quick_open_amount", Numeric(15, 6), nullable=False, server_default="1"),
            Column("hide_on_stock_overview", Integer, nullable=False, server_default="0"),
            Column("default_stock_label_type", Integer, nullable=False, server_default="0"),
            Column("qu_id_consume", Integer, nullable=True),
            Column("qu_id_price", Integer, nullable=True),
            Column("disable_open", Integer, nullable=False, server_default="0"),
            Column("default_purchase_price_type", Integer, nullable=False, server_default="1"),
        ],
        "locations": [
            Column("active", Integer, nullable=False, server_default="1"),
        ],
        "quantity_units": [
            Column("active", Integer, nullable=False, server_default="1"),
        ],
        "shopping_locations": [
            Column("active", Integer, nullable=False, server_default="1"),
        ],
        "product_groups": [
            Column("active", Integer, nullable=False, server_default="1"),
        ],
        "recipes": [
            Column("picture_file_name", String(255), nullable=True),
            Column("not_check_shoppinglist", Integer, nullable=False, server_default="0"),
            Column("product_id", Integer, nullable=True),
        ],
        "recipes_pos": [
            Column("price_factor", Numeric(15, 6), nullable=False, server_default="1"),
            Column("round_up", Integer, nullable=False, server_default="0"),
        ],
        "api_keys": [
            Column("last_used", DateTime, nullable=True),
        ],
        "userfields": [
            Column("input_required", Integer, nullable=False, server_default="0"),
            Column("default_value", Text, nullable=True),
        ],
        "meal_plan_sections": [
            Column("time_info", String(255), nullable=True),
        ],
    }
    for table, columns in additions.items():
        existing = {column["name"] for column in inspect(op.get_bind()).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    op.execute("UPDATE products SET qu_id_consume = qu_id_stock WHERE qu_id_consume IS NULL")
    op.execute("UPDATE products SET qu_id_price = qu_id_purchase WHERE qu_id_price IS NULL")


def downgrade() -> None:
    # Keep imported values. Restore a database backup to remove these columns.
    pass
