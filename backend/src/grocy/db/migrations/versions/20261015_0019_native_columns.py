"""Use the pinned native SQLite defaults and nullability."""

from alembic import op
from sqlalchemy import CheckConstraint, inspect, text

from grocy.db.native_columns import native_column_rules

revision = "20261015_0019"
down_revision = "20261015_0018"
branch_labels = None
depends_on = None


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    schema = dict(
        bind.exec_driver_sql("SELECT name,sql FROM sqlite_master WHERE type='table'").all()
    )
    changes = {}
    for table, rules in native_column_rules().items():
        if table not in schema:
            continue
        columns = {column["name"]: column for column in inspector.get_columns(table)}
        pending = {
            name: (columns[name], rule)
            for name, rule in rules.items()
            if name in columns
            and (
                columns[name]["nullable"] != rule["nullable"]
                or columns[name]["default"] != rule["default"]
            )
        }
        if pending:
            changes[table] = pending
    if not changes:
        return
    sequences = dict(bind.exec_driver_sql("SELECT name,seq FROM sqlite_sequence").all())
    views = list(
        bind.exec_driver_sql("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY rowid")
    )
    triggers = list(
        bind.exec_driver_sql(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY rowid"
        )
    )
    for name, _statement in triggers:
        bind.exec_driver_sql(f"DROP TRIGGER {_quote(name)}")
    for name, _statement in views:
        bind.exec_driver_sql(f"DROP VIEW {_quote(name)}")
    for table, pending in changes.items():
        checks = tuple(
            CheckConstraint(check["sqltext"])
            for check in inspector.get_check_constraints(table)
            if check["name"] is None
        )
        with op.batch_alter_table(
            table,
            recreate="always",
            table_kwargs={"sqlite_autoincrement": "AUTOINCREMENT" in schema[table].upper()},
            table_args=checks,
        ) as batch:
            for name, (column, rule) in pending.items():
                default = rule["default"]
                batch.alter_column(
                    name,
                    existing_type=column["type"],
                    nullable=rule["nullable"],
                    server_default=text(default) if default is not None else None,
                )
        if table in sequences:
            bind.exec_driver_sql(
                "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?", (sequences[table], table)
            )
            bind.exec_driver_sql(
                "INSERT INTO sqlite_sequence (name,seq) SELECT ?,? "
                "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (table, sequences[table], table),
            )
        else:
            # An empty-table copy can create a zero counter that did not exist.
            bind.exec_driver_sql("DELETE FROM sqlite_sequence WHERE name=?", (table,))
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for _name, statement in triggers:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    # Keep the native defaults and records permitted by native nullability.
    pass
