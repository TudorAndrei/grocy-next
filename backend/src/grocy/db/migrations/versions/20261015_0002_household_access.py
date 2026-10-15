"""Add equipment and persistent permissions."""

from alembic import op

revision = "20261015_0002"
down_revision = "20261014_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from grocy.db.models.equipment import Equipment
    from grocy.db.models.users import UserPermission

    Equipment.metadata.tables["equipment"].create(op.get_bind(), checkfirst=True)
    UserPermission.metadata.tables["user_permissions"].create(op.get_bind(), checkfirst=True)
    op.execute(
        "INSERT INTO user_permissions (user_id, permission_id) "
        "SELECT id, 1 FROM users WHERE NOT EXISTS "
        "(SELECT 1 FROM user_permissions WHERE user_id = users.id)"
    )


def downgrade() -> None:
    op.drop_table("user_permissions")
    op.drop_table("equipment")
