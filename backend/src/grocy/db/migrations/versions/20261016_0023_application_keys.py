"""Separate legacy application credentials from native Grocy credentials."""

import sqlite3
from contextlib import closing
from pathlib import Path

from alembic import op

from grocy.db.models.users import ImportedApiKey

revision = "20261016_0023"
down_revision = "20261015_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    ImportedApiKey.metadata.tables["grocy_imported_api_keys"].create(bind, checkfirst=True)
    filename = bind.engine.url.database
    if filename and filename != ":memory:":
        database = Path(filename).resolve()
        snapshot = database.with_suffix(database.suffix + ".source.sqlite")
        if snapshot.is_file():
            with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as original:
                if original.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_keys'"
                ).fetchone():
                    for key_id, key in original.execute("SELECT id,api_key FROM api_keys"):
                        bind.exec_driver_sql(
                            "INSERT OR IGNORE INTO grocy_imported_api_keys(api_key_id) "
                            "SELECT id FROM api_keys WHERE id=? AND api_key=?",
                            (key_id, key),
                        )
    # Earlier application keys had no expiry or used token_urlsafe(32).
    # Original Grocy-generated default keys have 50 characters and a saved expiry.
    bind.exec_driver_sql(
        "UPDATE api_keys SET key_type='grocy-next' WHERE key_type='default' "
        "AND (expires IS NULL OR LENGTH(api_key)=43 OR description='Bootstrap development key') "
        "AND id NOT IN (SELECT api_key_id FROM grocy_imported_api_keys)"
    )


def downgrade() -> None:
    pass
