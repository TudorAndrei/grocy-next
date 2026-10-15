"""Match native reference constraints and install the pinned validation triggers."""

from alembic import op
from sqlalchemy import CheckConstraint, Integer, inspect

from grocy.db.grocy_references import GROCY_450_REFERENCES
from grocy.db.reference_triggers import install_reference_triggers

revision = "20261015_0016"
down_revision = "20261015_0015"
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
    for table, references in GROCY_450_REFERENCES.items():
        if table not in schema:
            continue
        keys = []
        for key in inspector.get_foreign_keys(table):
            columns = key["constrained_columns"]
            if (
                len(columns) == 1
                and len(key["referred_columns"]) == 1
                and references.get(columns[0])
                == f"{key['referred_table']}.{key['referred_columns'][0]}"
            ):
                keys.append(key)
        if keys:
            changes[table] = keys
    nullable_unit = any(
        column["name"] == "qu_id" and not column["nullable"]
        for column in inspector.get_columns("recipes_pos")
    )
    if nullable_unit:
        changes.setdefault("recipes_pos", [])
    unique_sections = any(
        key["column_names"] == ["name"]
        for key in inspector.get_unique_constraints("meal_plan_sections")
    )
    if not unique_sections:
        changes.setdefault("meal_plan_sections", [])
    if changes:
        sequences = dict(bind.exec_driver_sql("SELECT name,seq FROM sqlite_sequence").all())
        views = list(
            bind.exec_driver_sql(
                "SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY rowid"
            )
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
        for table, keys in changes.items():
            checks = tuple(
                CheckConstraint(check["sqltext"])
                for check in inspector.get_check_constraints(table)
                if check["name"] is None
            )
            with op.batch_alter_table(
                table,
                recreate="always",
                naming_convention={
                    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
                },
                table_kwargs={"sqlite_autoincrement": "AUTOINCREMENT" in schema[table].upper()},
                table_args=checks,
            ) as batch:
                for key in keys:
                    name = (
                        key["name"]
                        or f"fk_{table}_{key['constrained_columns'][0]}_{key['referred_table']}"
                    )
                    batch.drop_constraint(name, type_="foreignkey")
                if table == "recipes_pos" and nullable_unit:
                    batch.alter_column("qu_id", existing_type=Integer(), nullable=True)
                if table == "meal_plan_sections" and not unique_sections:
                    batch.create_unique_constraint("uq_meal_plan_sections_name", ["name"])
            if table in sequences:
                bind.exec_driver_sql(
                    "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?",
                    (sequences[table], table),
                )
                bind.exec_driver_sql(
                    "INSERT INTO sqlite_sequence (name,seq) SELECT ?,? "
                    "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                    (table, sequences[table], table),
                )
        for _name, statement in views:
            bind.exec_driver_sql(statement)
        for _name, statement in triggers:
            bind.exec_driver_sql(statement)
    bind.exec_driver_sql(
        "INSERT INTO meal_plan_sections (id,name,sort_number) SELECT -1,'',-1 "
        "WHERE NOT EXISTS (SELECT 1 FROM meal_plan_sections WHERE id=-1)"
    )
    install_reference_triggers(bind)


def downgrade() -> None:
    # Restoring the old constraints would reject native records with missing parents.
    pass
