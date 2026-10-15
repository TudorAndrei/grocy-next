"""Keep user references after a user-row delete, as in Grocy 4.5.0."""

from alembic import op
from sqlalchemy import inspect

revision = "20261015_0012"
down_revision = "20261015_0011"
branch_labels = None
depends_on = None

_USER_REFERENCES = {
    "api_keys": ("user_id",),
    "chores": (
        "next_execution_assigned_to_user_id",
        "rescheduled_next_execution_assigned_to_user_id",
    ),
    "chores_log": ("done_by_user_id",),
    "nutrition_evidence": ("contributor_id",),
    "nutrition_proposals": ("created_by", "approved_by"),
    "nutrition_revisions": ("actor_id",),
    "product_nutrition": ("updated_by",),
    "stock_log": ("user_id",),
    "tasks": ("assigned_to_user_id",),
    "user_permissions": ("user_id",),
    "user_settings": ("user_id",),
}


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    schema = dict(
        bind.exec_driver_sql("SELECT name, sql FROM sqlite_master WHERE type='table'").all()
    )
    sequences = (
        dict(bind.exec_driver_sql("SELECT name, seq FROM sqlite_sequence").all())
        if "sqlite_sequence" in schema
        else {}
    )
    user_sequence = max(
        int(sequences.get("users", 0)),
        bind.exec_driver_sql("SELECT COALESCE(MAX(id), 0) FROM users").scalar_one(),
    )
    repair_sequence = "AUTOINCREMENT" not in schema["users"].upper() or "users" not in sequences
    changes = {}
    for table, columns in _USER_REFERENCES.items():
        if table not in schema:
            continue
        inspector = inspect(bind)
        present = {column["name"] for column in inspector.get_columns(table)}
        for column in columns:
            if repair_sequence and column in present:
                maximum = bind.exec_driver_sql(
                    f"SELECT MAX({_quote(column)}) FROM {_quote(table)}"
                ).scalar_one()
                if isinstance(maximum, int):
                    user_sequence = max(user_sequence, maximum)
        foreign_keys = [
            fk for fk in inspector.get_foreign_keys(table) if fk["referred_table"] == "users"
        ]
        if foreign_keys:
            changes[table] = foreign_keys
    if "AUTOINCREMENT" not in schema["users"].upper():
        changes["users"] = []
    if changes:
        views = list(bind.exec_driver_sql("SELECT name, sql FROM sqlite_master WHERE type='view'"))
        triggers = [
            row.sql
            for row in bind.exec_driver_sql(
                "SELECT tbl_name, sql FROM sqlite_master WHERE type='trigger'"
            )
            if row.tbl_name in changes
        ]
        for name, _sql in views:
            bind.exec_driver_sql(f"DROP VIEW {_quote(name)}")
        for table, foreign_keys in changes.items():
            with op.batch_alter_table(
                table,
                recreate="always",
                naming_convention={
                    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
                },
                table_kwargs={
                    "sqlite_autoincrement": table == "users"
                    or "AUTOINCREMENT" in schema[table].upper()
                },
            ) as batch:
                for foreign_key in foreign_keys:
                    name = (
                        foreign_key["name"]
                        or f"fk_{table}_{foreign_key['constrained_columns'][0]}_users"
                    )
                    batch.drop_constraint(name, type_="foreignkey")
        for _name, statement in views:
            bind.exec_driver_sql(statement)
        for statement in triggers:
            bind.exec_driver_sql(statement)
        for table in changes:
            if table in sequences:
                bind.exec_driver_sql(
                    "UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name=?",
                    (sequences[table], table),
                )
    # Retained keys must never authenticate as a newly allocated user.
    bind.exec_driver_sql(
        "UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='users'", (user_sequence,)
    )
    bind.exec_driver_sql(
        "INSERT INTO sqlite_sequence (name, seq) SELECT 'users', ? "
        "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='users')",
        (user_sequence,),
    )


def downgrade() -> None:
    # Restoring the constraints would discard valid saved history with deleted users.
    pass
