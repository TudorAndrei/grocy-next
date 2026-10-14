"""initial schema with nutrition extensions

Revision ID: 20261014_0001
Revises:
Create Date: 2026-10-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261014_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    from grocy.db.models import Base

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    from grocy.db.models import Base

    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
