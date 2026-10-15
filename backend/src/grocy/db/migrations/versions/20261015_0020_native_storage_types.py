"""Use native SQLite storage affinity without losing saved values."""

from alembic import op
from sqlalchemy import CheckConstraint, String, inspect
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import TypeDecorator

from grocy.db.native_columns import native_column_rules, storage_affinity

revision = "20261015_0020"
down_revision = "20261015_0019"
branch_labels = None
depends_on = None


class _StorageDeclaration(TypeDecorator):
    impl = String
    cache_ok = True

    def __init__(self, declaration, previous_type):
        self.declaration = declaration
        self.previous_type = previous_type
        super().__init__()
        self.impl = previous_type


@compiles(_StorageDeclaration, "sqlite")
def _storage_sql(column_type, _compiler, **_kwargs):
    return column_type.declaration


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
            name: (columns[name], rule["type"])
            for name, rule in rules.items()
            if name in columns
            and "type" in rule
            and storage_affinity(str(columns[name]["type"])) != storage_affinity(rule["type"])
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
        fields = ",".join(_quote(name) for name in ["id", *pending])
        before = bind.exec_driver_sql(f"SELECT {fields} FROM {_quote(table)} ORDER BY id").all()
        checks = tuple(
            CheckConstraint(check["sqltext"])
            for check in inspector.get_check_constraints(table)
            if check["name"] is None
        )
        with op.batch_alter_table(
            table,
            recreate="always",
            table_args=checks,
            table_kwargs={"sqlite_autoincrement": "AUTOINCREMENT" in schema[table].upper()},
        ) as batch:
            for name, (column, declaration) in pending.items():
                # Retain the ORM codec affinity. A SQL CAST to DATETIME would
                # reduce a date string to its year. SQLite applies the new
                # table's storage affinity during the copy without that cast.
                column_type = _StorageDeclaration(declaration, column["type"])
                batch.alter_column(name, existing_type=column["type"], type_=column_type)
        after = bind.exec_driver_sql(f"SELECT {fields} FROM {_quote(table)} ORDER BY id").all()
        if before != after:
            raise ValueError(f"Native storage for {table} would change a saved value")
        if table in sequences:
            bind.exec_driver_sql(
                "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?", (sequences[table], table)
            )
            bind.exec_driver_sql(
                "INSERT INTO sqlite_sequence(name,seq) SELECT ?,? "
                "WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (table, sequences[table], table),
            )
        else:
            bind.exec_driver_sql("DELETE FROM sqlite_sequence WHERE name=?", (table,))
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for _name, statement in triggers:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    # Keep native storage and values already written with that storage affinity.
    pass
