# Database import and recovery

The importer reads a Grocy SQLite database and creates a new Grocy Next database. It does not replace an existing destination. Stop the source application before an import for a fixed source state.

```bash
cd backend
uv run grocy-cli validate-import /path/to/grocy.db
uv run grocy-cli import /path/to/grocy.db /path/to/grocy-next.db
```

The importer checks SQLite integrity and the required core tables. It takes a SQLite backup, including committed WAL pages. It copies supported table columns, converts dates, maps upstream custom field values, checks references, and records the current schema revision. An import failure removes the incomplete destination and snapshot.

The command returns the destination path, source snapshot path, copied row counts, and archived tables and columns. Data outside the active application schema remains in the exact source snapshot. Review this report before you use the new database.

Set the new database and turn off demo data:

```bash
GROCY_DATABASE_URL=sqlite+aiosqlite:////absolute/path/to/grocy-next.db
GROCY_SEED_DEMO_DATA=false
```

Copy the source files separately to `GROCY_FILES_ROOT`. Database import does not copy manuals, images, or other files. Existing API keys and permissions transfer with their records. The importer also keeps keys, settings, and permissions for deleted users. It preserves the source user ID sequence, so later users cannot receive those deleted user IDs. If the source has no permission table, imported users receive the administrator permission.

## Project schema upgrades

The application uses Alembic and applies upgrades at startup when automatic schema creation is enabled. Manual upgrades use:

```bash
cd backend
uv run alembic upgrade head
```

The contract field migration keeps added fields on downgrade to preserve user data. For a full rollback, stop the application and restore a database backup. Keep the database and file directory together in backups. Use SQLite backup commands for a running database, or stop the service before copying its files.

Revision 0012 changes user references to match Grocy 4.5.0. Deleting a user keeps related keys, settings, permissions, assignments, and history. Retained keys return 401. Nutrition records also keep their saved contributor IDs. The upgrade keeps the other reference constraints, indexes, custom views, and triggers.

Startup and manual upgrades use a SQLite transaction. They turn foreign key checks off before the transaction and restore them afterward. This permits the required table rebuilds, as described in [Alembic's batch upgrade guidance](https://alembic.sqlalchemy.org/en/latest/batch.html#dealing-with-referencing-foreign-keys).

Deleting the last user keeps the database without users after restart. Demo data creation does not replace a deleted user. New databases still receive demo data when that setting is enabled.

Revision 0013 keeps the permission row counter after replacement deletes old rows. The upgrade preserves custom views, indexes, and triggers. Imports also copy the counters for the target tables that use SQLite `AUTOINCREMENT`, including users and permissions. A source counter can be higher than all remaining row IDs.
