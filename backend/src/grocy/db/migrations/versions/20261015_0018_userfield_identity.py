"""Use native field IDs and text object keys for custom values."""

from alembic import op
from sqlalchemy import CheckConstraint, Column, Integer, Text, inspect

from grocy.db.reference_triggers import install_userfield_triggers
from grocy.db.userfield_identity import legacy_field_ids

revision = "20261015_0018"
down_revision = "20261015_0017"
branch_labels = None
depends_on = None


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"]: column for column in inspect(bind).get_columns("userfield_values")}
    sequence = bind.exec_driver_sql(
        "SELECT seq FROM sqlite_sequence WHERE name='userfield_values'"
    ).scalar()
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
    if "field_id" not in columns:
        op.add_column("userfield_values", Column("field_id", Integer(), nullable=True))
    if {"entity", "name"} <= columns.keys():
        mapping = legacy_field_ids(
            [
                tuple(row)
                for row in bind.exec_driver_sql("SELECT entity,name,id FROM userfields ORDER BY id")
            ],
            [
                tuple(row)
                for row in bind.exec_driver_sql(
                    "SELECT DISTINCT entity,name FROM userfield_values WHERE field_id IS NULL"
                )
            ],
        )
        for (entity, name), field_id in mapping.items():
            bind.exec_driver_sql(
                "UPDATE userfield_values SET field_id=? WHERE field_id IS NULL "
                "AND COALESCE(entity,'')=? AND COALESCE(name,'')=?",
                (field_id, entity, name),
            )
    # Native empty-value triggers represent these legacy values as absent records.
    bind.exec_driver_sql("DELETE FROM userfield_values WHERE value IS NULL OR value=''")
    checks = tuple(
        CheckConstraint(check["sqltext"])
        for check in inspect(bind).get_check_constraints("userfield_values")
        if check["name"] is None
    )
    unique = any(
        key["column_names"] == ["field_id", "object_id"]
        for key in inspect(bind).get_unique_constraints("userfield_values")
    )
    with op.batch_alter_table(
        "userfield_values",
        recreate="always",
        table_kwargs={"sqlite_autoincrement": True},
        table_args=checks,
    ) as batch:
        batch.alter_column("field_id", existing_type=Integer(), nullable=False)
        batch.alter_column(
            "object_id", existing_type=columns["object_id"]["type"], type_=Text(), nullable=False
        )
        batch.alter_column("value", existing_type=columns["value"]["type"], nullable=False)
        for name in ("entity", "name"):
            if name in columns:
                batch.alter_column(name, existing_type=columns[name]["type"], nullable=True)
        if not unique:
            batch.create_unique_constraint("uq_userfield_value_identity", ["field_id", "object_id"])
    if sequence is not None:
        bind.exec_driver_sql(
            "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='userfield_values'", (sequence,)
        )
        bind.exec_driver_sql(
            "INSERT INTO sqlite_sequence (name,seq) SELECT 'userfield_values',? "
            "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='userfield_values')",
            (sequence,),
        )
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for _name, statement in triggers:
        bind.exec_driver_sql(statement)
    install_userfield_triggers(bind)


def downgrade() -> None:
    # Preserve field identity and native orphan records.
    pass
