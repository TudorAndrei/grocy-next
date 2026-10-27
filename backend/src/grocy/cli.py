import argparse
import json
import sys

from grocy.db.imports.validate import validate_grocy_sqlite


def cmd_validate_import(args: argparse.Namespace) -> int:
    result = validate_grocy_sqlite(args.database)
    print(json.dumps(result.__dict__, indent=2))
    return 0 if result.ok else 1


def cmd_import(args: argparse.Namespace) -> int:
    from grocy.db.imports.importer import import_grocy_sqlite

    try:
        result = import_grocy_sqlite(args.database, args.destination)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, indent=2))
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    import asyncio
    import secrets

    from sqlalchemy import select

    from grocy.core.config import get_settings
    from grocy.db.models.users import ApiKey, User, UserPermission
    from grocy.db.session import get_engine, get_session_factory, upgrade_schema

    async def initialize():
        settings = get_settings()
        database_url = settings.active_database_url()
        if database_url.startswith("sqlite") and ":memory:" not in database_url:
            from sqlalchemy.engine import make_url

            database = make_url(database_url).database
            if database:
                from pathlib import Path

                Path(database).parent.mkdir(parents=True, exist_ok=True)
        engine = get_engine()
        await upgrade_schema(engine)
        async with get_session_factory()() as session:
            if await session.scalar(select(User.id).limit(1)) is not None:
                raise ValueError("Database already has users")
            key = secrets.token_urlsafe(32)
            user = User(username=args.username)
            session.add(user)
            await session.flush()
            session.add_all(
                [
                    ApiKey(user_id=user.id, api_key=key, key_type="grocy-next"),
                    UserPermission(user_id=user.id, permission_id=1),
                ]
            )
            await session.commit()
            print(json.dumps({"user_id": user.id, "api_key": key}))
        await engine.dispose()

    try:
        asyncio.run(initialize())
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def cmd_mcp(_args: argparse.Namespace | None = None) -> int:
    from grocy.mcp.server import create_mcp_server

    server = create_mcp_server()
    server.run()
    return 0


def cmd_mcp_entry() -> None:
    raise SystemExit(cmd_mcp())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="grocy")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate-import", help="Validate a Grocy SQLite database")
    validate.add_argument("database")
    validate.set_defaults(func=cmd_validate_import)

    importer = sub.add_parser("import", help="Import Grocy into a new SQLite database")
    importer.add_argument("database")
    importer.add_argument("destination")
    importer.set_defaults(func=cmd_import)

    initialize = sub.add_parser("init", help="Create the first administrator and API key")
    initialize.add_argument("--username", default="admin")
    initialize.set_defaults(func=cmd_init)

    mcp = sub.add_parser("mcp", help="Run the FastMCP server over stdio")
    mcp.set_defaults(func=cmd_mcp)

    args = parser.parse_args(argv)
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main(sys.argv[1:])
