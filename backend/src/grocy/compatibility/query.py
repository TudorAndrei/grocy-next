import re
from typing import Any
from urllib.parse import parse_qsl

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError

_FILTER = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)(!=|!~|>=|<=|=|~|>|<|§)(.+)")
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_OPERATORS = {"=": "=", "!=": "!=", "~": "LIKE", "!~": "NOT LIKE", "§": "REGEXP"}


def parse_list_query(
    query_string: bytes,
) -> tuple[list[tuple[str, str, str]], str | None, int | None, int | None]:
    filters = []
    options = {}
    for key, value in parse_qsl(query_string.decode(), keep_blank_values=True):
        if key == "query[]" or re.fullmatch(r"query\[\d+\]", key):
            match = _FILTER.fullmatch(value)
            if match is None:
                raise GrocyError("Invalid query", code=None)
            filters.append(match.groups())
        elif key in {"order", "limit", "offset"}:
            options[key] = value
    try:
        limit = int(options["limit"]) if "limit" in options else None
        offset = int(options["offset"]) if "offset" in options else None
        if any(value is not None and not -(2**63) <= value < 2**63 for value in (limit, offset)):
            raise ValueError
    except ValueError as error:
        raise GrocyError("Invalid limit or offset", code=None) from error
    return filters, options.get("order"), limit, offset


async def query_rows(
    session: AsyncSession,
    table: str,
    query_string: bytes = b"",
    columns: list[str] | None = None,
) -> list[dict[str, Any]]:
    if _IDENTIFIER.fullmatch(table) is None:
        raise GrocyError("Invalid entity", code=None)
    if columns is None:
        result = await session.execute(text(f'SELECT * FROM "{table}" LIMIT 0'))
        columns = list(result.keys())
    allowed = set(columns)
    filters, order, limit, offset = parse_list_query(query_string)
    projection = ",".join(f'"{column}"' for column in columns)
    query = f'SELECT {projection} FROM "{table}"'
    predicates = []
    parameters: dict[str, Any] = {}
    for index, (field, operator, value) in enumerate(filters):
        if field not in allowed:
            raise GrocyError(f"Invalid query field {field}", code=None)
        parameter = f"filter_{index}"
        operation = _OPERATORS.get(operator, operator)
        predicate = f'"{field}" {operation} :{parameter}'
        if operator in {"=", "!="} and value.lower() == "null":
            predicate = f'({predicate} OR "{field}" IS NULL)'
        predicates.append(predicate)
        parameters[parameter] = f"%{value}%" if operator in {"~", "!~"} else value
    if predicates:
        query += " WHERE " + " AND ".join(predicates)
    if order is not None:
        parts = order.split(":")
        field, direction = parts[0], parts[1] if len(parts) == 2 else "asc"
        if len(parts) > 2 or direction not in {"asc", "desc"}:
            raise GrocyError(f"Invalid sort order {direction}", code=None)
        if field not in allowed:
            raise GrocyError(f"Invalid sort field {field}", code=None)
        query += f' ORDER BY "{field}" {direction.upper()}'
    if limit is not None or offset is not None:
        query += " LIMIT :limit OFFSET :offset"
        parameters.update(limit=limit if limit is not None else -1, offset=offset or 0)
    result = await session.execute(text(query), parameters)
    return [dict(row) for row in result.mappings()]
