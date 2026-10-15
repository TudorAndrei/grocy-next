"""Match Grocy 4.5.0 equipment, shopping list, and recipe nesting uniqueness."""

from alembic import op
from sqlalchemy import inspect

revision = "20261015_0017"
down_revision = "20261015_0016"
branch_labels = None
depends_on = None

_KEYS = {
    "equipment": ("name",),
    "shopping_lists": ("name",),
    "recipes_nestings": ("recipe_id", "includes_recipe_id"),
}


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    for table, columns in _KEYS.items():
        existing = {
            tuple(key["column_names"]) for key in inspector.get_unique_constraints(table)
        } | {
            tuple(index["column_names"])
            for index in inspector.get_indexes(table)
            if index["unique"] and index.get("dialect_options", {}).get("sqlite_where") is None
        }
        if columns not in existing:
            op.create_index(f"uq_{table}_{'_'.join(columns)}", table, list(columns), unique=True)


def downgrade() -> None:
    # Retain the pinned native persistence rules.
    pass
