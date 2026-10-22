"""Grocy FilteredApiResponse query parameters applied with the SQL that LessQL generates."""

from typing import Any
from urllib.parse import unquote_to_bytes

import regex
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.input import database_error
from grocy.compatibility.php import INT_MAX, INT_MIN, argument_error, intval, php_error

_QUERY_KEYS = ("query", "limit", "offset", "order")
_CONDITION = regex.compile(
    r"(?P<field>[A-Za-z_][A-Za-z0-9_]+)(?P<op>!?(?:>=|<=|=|~|<|>|§))"
    r"(?P<value>[A-Za-z\p{L}\p{M}0-9*_.$#^| -\\]+)"
)
_ARRAY_INTEGER = regex.compile(r"0|-?[1-9][0-9]*")
_COMPARISONS = {"<", ">", ">=", "<="}


def _decode(value: bytes) -> str:
    return unquote_to_bytes(value.replace(b"+", b" ")).decode("utf-8", "surrogateescape")


def _array_key(key: str) -> int | str:
    if _ARRAY_INTEGER.fullmatch(key) and INT_MIN <= int(key) <= INT_MAX:
        return int(key)
    return key


def _append(table: dict[Any, Any], value: Any) -> None:
    table[max((key for key in table if isinstance(key, int)), default=-1) + 1] = value


def _register(parameters: dict[Any, Any], name: str, value: str) -> None:
    name = name.lstrip(" ")
    bracket = name.find("[")
    base = (name if bracket < 0 else name[:bracket]).replace(" ", "_").replace(".", "_")
    if not base:
        return
    table: dict[Any, Any] = parameters
    key: str | None = base
    remaining = "" if bracket < 0 else name[bracket:]
    first = True
    while remaining:
        inner = remaining[1:]
        start = 1 if inner.startswith(" ") else 0
        if inner[start:].startswith("]"):
            segment = None
            after = inner[start + 1 :]
        else:
            close = inner.find("]", start)
            if close < 0:
                if first:
                    key = base + "_" + inner.replace(" ", "_").replace(".", "_").replace("[", "_")
                break
            segment = inner[:close]
            after = inner[close + 1 :]
        if key is None:
            child: dict[Any, Any] = {}
            _append(table, child)
        else:
            existing = table.get(_array_key(key))
            child = existing if isinstance(existing, dict) else {}
            table[_array_key(key)] = child
        table, key, first = child, segment, False
        remaining = after if after.startswith("[") else ""
    if key is None:
        _append(table, value)
    else:
        table[_array_key(key)] = value


def query_parameters(query_string: bytes) -> dict[Any, Any]:
    parameters: dict[Any, Any] = {}
    for pair in query_string.split(b"&"):
        if pair:
            name, _, value = pair.partition(b"=")
            _register(parameters, _decode(name), _decode(value))
    return parameters


def filtered(parameters: dict[Any, Any]) -> bool:
    return any(key in parameters for key in _QUERY_KEYS)


def _identifier(name: str) -> str:
    return ".".join("`" + part.replace("`", "``") + "`" for part in name.split("."))


def _conditions(filters: Any) -> tuple[list[str], list[str]]:
    if not isinstance(filters, dict):
        raise argument_error(
            "Grocy\\Controllers\\BaseApiController::filter", 2, "query", "array", filters
        )
    conditions: list[str] = []
    values: list[str] = []
    for item in filters.values():
        if isinstance(item, dict):
            raise php_error(
                "preg_match(): Argument #2 ($subject) must be of type string, array given"
            )
        match = None if _invalid_text(item) else _CONDITION.search(item)
        if match is None:
            raise php_error("Invalid query")
        field, operator, value = match["field"], match["op"], match["value"]
        alternative = f" OR {field} IS NULL" if value.lower() == "null" else ""
        if operator in {"=", "!="}:
            conditions.append(f"{field} {operator} ?{alternative}")
            values.append(value)
        elif operator in {"~", "!~"}:
            conditions.append(f"{field} {'NOT LIKE' if operator == '!~' else 'LIKE'} ?")
            values.append(f"%{value}%")
        elif operator in _COMPARISONS:
            conditions.append(f"{field} {operator} ?")
            values.append(value)
        elif operator == "§":
            conditions.append(f"{field} REGEXP ?")
            values.append(value)
    return conditions, values


def _invalid_text(value: str) -> bool:
    try:
        value.encode()
    except UnicodeEncodeError:
        return True
    return False


def _order(order: Any) -> str:
    if isinstance(order, dict):
        raise php_error("explode(): Argument #2 ($string) must be of type string, array given")
    parts = order.split(":")
    if len(parts) == 1:
        return f"{_identifier(parts[0])} ASC"
    if parts[1] not in {"asc", "desc"}:
        raise php_error(f"Invalid sort order {parts[1]}")
    return f"{_identifier(parts[0])} {parts[1]}"


async def query_rows(
    session: AsyncSession, table: str, parameters: dict[Any, Any]
) -> list[dict[str, Any]]:
    conditions: list[str] = []
    values: list[str] = []
    if "query" in parameters:
        conditions, values = _conditions(parameters["query"])
    limit = None
    if "limit" in parameters or "offset" in parameters:
        limit = (intval(parameters.get("limit", -1)), intval(parameters.get("offset", 0)))
    order = _order(parameters["order"]) if "order" in parameters else None
    statement = f"SELECT * FROM {_identifier(table)}"
    if conditions:
        statement += " WHERE (" + ") AND (".join(conditions) + ")"
    if order is not None:
        statement += f" ORDER BY {order}"
    if limit is not None:
        statement += f" LIMIT {limit[0]} OFFSET {limit[1]}"
    connection = await session.connection()
    try:
        result = await connection.exec_driver_sql(statement, tuple(values))
    except DBAPIError as error:
        raise php_error(database_error(error).message) from error
    return [dict(row) for row in result.mappings()]
