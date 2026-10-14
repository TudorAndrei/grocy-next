import argparse
import json
import sys

from grocy.db.imports.validate import validate_grocy_sqlite


def cmd_validate_import(args: argparse.Namespace) -> int:
    result = validate_grocy_sqlite(args.database)
    print(json.dumps(result.__dict__, indent=2))
    return 0 if result.ok else 1


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

    mcp = sub.add_parser("mcp", help="Run the FastMCP server over stdio")
    mcp.set_defaults(func=cmd_mcp)

    args = parser.parse_args(argv)
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main(sys.argv[1:])
