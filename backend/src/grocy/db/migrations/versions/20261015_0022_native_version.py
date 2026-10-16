"""Record the installed native schema version when no source history exists."""

from alembic import op

revision = "20261015_0022"
down_revision = "20261015_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "INSERT INTO migrations(migration) SELECT 253 WHERE NOT EXISTS (SELECT 1 FROM migrations)"
    )


def downgrade() -> None:
    pass
