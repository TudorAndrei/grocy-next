"""Keep Grocy's permission row allocation after replacement deletes rows."""

from alembic import op

revision = "20261015_0013"
down_revision = "20261015_0012"
branch_labels = None
depends_on = None


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    schema = bind.exec_driver_sql(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_permissions'"
    ).scalar_one()
    if "AUTOINCREMENT" in schema.upper():
        return
    views = list(bind.exec_driver_sql("SELECT name, sql FROM sqlite_master WHERE type='view'"))
    triggers = list(
        bind.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='user_permissions'"
        ).scalars()
    )
    for name, _statement in views:
        bind.exec_driver_sql(f"DROP VIEW {_quote(name)}")
    with op.batch_alter_table(
        "user_permissions", recreate="always", table_kwargs={"sqlite_autoincrement": True}
    ):
        pass
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for statement in triggers:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    # Keep the counter so saved permission row IDs cannot be reused.
    pass
