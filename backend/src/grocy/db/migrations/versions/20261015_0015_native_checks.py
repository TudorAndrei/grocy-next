"""Apply the frozen Grocy 4.5.0 check expressions to existing project tables."""

from alembic import op
from sqlalchemy import CheckConstraint, inspect

from grocy.db.grocy_checks import GROCY_450_CHECKS

revision = "20261015_0015"
down_revision = "20261015_0014"
branch_labels = None
depends_on = None


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def upgrade() -> None:
    bind = op.get_bind()
    schema = dict(
        bind.exec_driver_sql("SELECT name,sql FROM sqlite_master WHERE type='table'").all()
    )
    changes: dict[str, list[CheckConstraint]] = {}
    for name, expressions in GROCY_450_CHECKS.items():
        if name not in schema:
            continue
        existing = inspect(bind).get_check_constraints(name)
        missing = set(expressions) - {check["sqltext"] for check in existing}
        if missing:
            # Alembic omits reflected unnamed CHECK constraints during a table copy.
            changes[name] = [
                CheckConstraint(check["sqltext"]) for check in existing if check["name"] is None
            ] + [CheckConstraint(expression) for expression in expressions if expression in missing]
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
    for name, checks in changes.items():
        with op.batch_alter_table(
            name,
            recreate="always",
            table_kwargs={"sqlite_autoincrement": "AUTOINCREMENT" in schema[name].upper()},
            table_args=tuple(checks),
        ):
            pass
        if name in sequences:
            bind.exec_driver_sql(
                "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?", (sequences[name], name)
            )
            bind.exec_driver_sql(
                "INSERT INTO sqlite_sequence (name,seq) SELECT ?,? "
                "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (name, sequences[name], name),
            )
    for _name, statement in views:
        bind.exec_driver_sql(statement)
    for _name, statement in triggers:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    # These checks remain part of the pinned database contract.
    pass
