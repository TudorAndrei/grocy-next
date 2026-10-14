# Migration

Upstream Grocy SQLite import is not implemented yet.

Planned process:

1. Pin a Grocy baseline release/commit.
2. Snapshot schema, views, triggers, and migrations into `contracts/`.
3. Validate and import a copy of the user database with backup + rollback.
4. Apply extension migrations (nutrition) only after the core schema is verified.
