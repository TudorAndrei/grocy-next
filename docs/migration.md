# Database import and recovery

The importer reads a Grocy SQLite database and creates a new Grocy Next database. It does not replace an existing destination. Stop the source application before an import for a fixed source state.

```bash
cd backend
uv run grocy-cli validate-import /path/to/grocy.db
uv run grocy-cli import /path/to/grocy.db /path/to/grocy-next.db
```

The importer checks SQLite integrity and the required core tables. It takes a SQLite backup, including committed WAL pages. It copies supported table columns, converts dates, maps upstream custom field values, checks active destination constraints, and records the current schema revision. An import failure removes the incomplete destination and snapshot.

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

Revision 0014 adds the Grocy allocation counters to the other 31 modeled native tables. All 33 modeled native tables now retain their counters after a delete. The four nutrition extension tables keep their existing allocation rules. Imports copy all 33 source counters, including values above all remaining row IDs.

The upgrade copies the affected tables in one transaction. It preserves stored rows, foreign keys, indexes, check constraints, views, and triggers. If a copy fails, the transaction restores the original schema and rows. Startup keeps matching meal-plan recipe contents, including their IDs and timestamps. It still repairs missing or changed contents.

An older project table without a saved counter starts from its highest remaining row ID. The upgrade cannot recover allocation history that the old database already lost. An original Grocy backup retains that history in `sqlite_sequence`.

Revision 0015 adds all 27 pinned Grocy `CHECK` expressions to the 16 affected modeled tables. It keeps rows, ID counters, existing constraints, indexes, views, and triggers. The table copy includes unnamed check constraints explicitly, as required by [Alembic's batch guidance](https://alembic.sqlalchemy.org/en/latest/batch.html#including-check-constraints).

An older project database can contain values that Grocy rejects. For example, earlier project versions accepted task `done=2`. Such a record makes revision 0015 fail. The transaction then restores the original schema, records, counters, and revision. Correct the invalid values through the previous application version before you repeat the upgrade. The upgrade does not change those values automatically.

Revision 0016 removes 36 project foreign keys across 15 native tables. Grocy 4.5.0 has no database foreign keys in the 33 modeled native tables. ORM links remain available. Nutrition constraints and custom database references remain active. Imports retain native records without their referenced parent rows.

The revision also installs nine pinned native validation and default triggers. Recipe ingredient units become nullable. Meal section names become unique. A database without the required default meal section receives row -1 with its native name and sort number. Existing rows, counters, custom constraints, views, indexes, and triggers remain saved.

Duplicate meal section names from an earlier project version can make revision 0016 fail. The failed copy restores the full original database, including its revision and ID counters. Resolve duplicate names through the previous application version before you repeat the upgrade. The default meal section cannot be deleted, as in Grocy.

Revision 0017 adds missing unique indexes for equipment names, shopping list names, and recipe nesting pairs. It recognizes existing unique constraints and full unique indexes with matching key columns. It keeps all table data, counters, views, triggers, and custom constraints. It does not copy tables.

Earlier project versions could save duplicates under these keys. Such duplicates make the upgrade fail. The transaction removes any indexes added earlier in the failed upgrade and restores the original revision. Resolve duplicate names or recipe nesting pairs through the previous application version before you repeat the upgrade. The upgrade does not delete or merge those records.

Revision 0018 gives custom values stable field IDs and text object keys. Matching legacy entity and name keys receive their current definition ID. Old entity and name columns remain as legacy metadata. Runtime reads and writes use the field ID. Meaningful values, row IDs, timestamps, and allocation counters remain saved. Existing null and empty values become absent records, as required by the native empty-value rule.

An unmatched legacy name cannot identify a deleted or previously renamed definition. The upgrade keeps that value under a reserved negative field ID. It retains the original entity and name metadata for recovery. A new definition with the same name does not receive that value. Original Grocy imports keep their actual field IDs, including IDs whose definitions no longer exist. Object key formatting already lost to an older integer column cannot be recovered.

The upgrade keeps custom views, indexes, and triggers. A custom constraint that rejects text object keys can make the table copy fail. The transaction then restores the complete original schema, values, empty records, counters, views, triggers, and revision. The same transaction covers startup and CLI upgrades.

Revision 0019 applies the pinned SQLite defaults and nullability for all 289 modeled native columns. It also gives two required extension columns their existing application defaults at the database level. Direct SQL inserts can then use the native database defaults. ORM input conversion remains a separate part of the compatibility audit.

The upgrade copies only tables whose column rules differ. It keeps stored rows, timestamps, allocation counters, absent counter entries, custom columns, constraints, indexes, views, and triggers. Null native creation timestamps remain null. API reads support those timestamps. Meal-plan records can retain the native default product amount of zero during updates.

A legacy record can violate a native required-column rule. For example, Grocy requires a non-null meal section ID. A saved null section makes the copy fail. The transaction restores the full original database and revision. Correct the invalid record through the previous application version before you repeat the upgrade. The upgrade does not replace saved null values with defaults.

Revision 0020 matches native SQLite storage affinity. It corrects 15 column rules across nine tables. Conversion factors and other native `REAL` values retain fractional SQL results. Native `INTEGER` columns keep their SQLite rules for fractional values. Chore log times use native `DATETIME` storage and retain date-only precision.

The copy uses SQLite assignment rules without SQL casts. It preserves dates, timestamps, nulls, empty text, counters, and custom SQL. Each changed value must remain equal. Integer `2` can become `2.0`. A large integer that cannot fit in `REAL` without loss stops the upgrade. A custom constraint can also reject the copy. Either failure restores the full original database and revision. No saved value is rounded or replaced to make the upgrade pass.


Revision 0021 installs all 45 native views and all 54 native triggers in their source creation order. It creates the four remaining native tables and fills the conversion cache and permission hierarchy. It keeps existing core rows and allocation counters. It also keeps custom SQL outside the native object names.

Some early project revisions did not save internal meal recipes. This upgrade repairs missing internal recipes through the native meal trigger. Normal startup then keeps the saved internal IDs and timestamps. A native object name conflict stops the upgrade. The transaction restores the complete original database and revision.

Generic writes now use the pinned LessQL library. Native database defaults replace Python defaults for these requests. Each successful statement commits separately. A later child error can leave its parent saved. The returned creation ID can belong to the last child. These are Grocy 4.5.0 rules. Custom field values must use `/api/userfields/{entity}/{id}`. The product editor saves its purchase factor through quantity unit conversions.

New household action timestamps use whole seconds, as in Grocy. Existing timestamp text remains saved. Generic timestamp fields retain the native SQLite input rules.

CLI initialization runs the same migrations. A database created with `grocy-cli init` can use native rules when automatic startup migrations are disabled.

Imported timestamp values bypass the runtime timestamp codec. The import keeps fractional seconds and native year 0000 timestamp text exactly. Some domain date operations still have separate year limits.

Custom triggers on replaced native views are saved before replacement. The upgrade restores them after the native triggers. A saved-database check confirms that such a custom trigger still executes after upgrade.
