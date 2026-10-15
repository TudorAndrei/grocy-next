"""Install the pinned Grocy calculated views."""

from alembic import op

from grocy.db.compatibility_views import install_compatibility_views

revision = "20261015_0007"
down_revision = "20261015_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    install_compatibility_views(op.get_bind())


def downgrade() -> None:
    # Keep read-only views when application code is reverted.
    pass
