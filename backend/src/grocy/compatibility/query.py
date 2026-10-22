import math
import re
from typing import Any
from urllib.parse import parse_qsl

import regex
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import GrocyError

_FILTER = regex.compile(
    r"(?P<field>[A-Za-z_][A-Za-z0-9_]+)(?P<operator>!?(?:>=|<=|=|~|<|>|§))"
    r"(?P<value>[A-Za-z\p{L}\p{M}0-9*_.$#^| -\\]+)"
)
_INTEGER = re.compile(r"[ \t\n\r\v\f]*([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_OPERATORS = {
    "=": "=",
    "!=": "!=",
    "~": "LIKE",
    "!~": "NOT LIKE",
    "<": "<",
    ">": ">",
    ">=": ">=",
    "<=": "<=",
    "§": "REGEXP",
}


def _integer(value: str) -> int:
    match = _INTEGER.match(value)
    if match is None:
        return 0
    number = match.group(1)
    if number.lstrip("+-").isdigit():
        result = int(number)
    else:
        decimal = float(number)
        if not math.isfinite(decimal):
            return 0
        result = int(decimal)
    return max(-(2**63), min(2**63 - 1, result))


def parse_list_query(
    query_string: bytes,
) -> tuple[list[tuple[str, str, str]], str | None, int | None, int | None]:
    filters = []
    options = {}
    for key, value in parse_qsl(query_string.decode(), keep_blank_values=True):
        if key == "query":
            raise GrocyError("Invalid query", code=None)
        if re.fullmatch(r"query\[[^\]]*\]", key):
            match = _FILTER.search(value)
            if match is None:
                raise GrocyError("Invalid query", code=None)
            filters.append((match["field"], match["operator"], match["value"]))
        elif key in {"order", "limit", "offset"}:
            options[key] = value
    limit = _integer(options["limit"]) if "limit" in options else None
    offset = _integer(options["offset"]) if "offset" in options else None
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
        operation = _OPERATORS.get(operator)
        if operation is None:
            continue
        if field not in allowed:
            raise GrocyError(f"Invalid query field {field}", code=None)
        parameter = f"filter_{index}"
        predicate = f'"{field}" {operation} :{parameter}'
        if operator in {"=", "!="} and value.lower() == "null":
            predicate = f'({predicate} OR "{field}" IS NULL)'
        predicates.append(predicate)
        parameters[parameter] = f"%{value}%" if operator in {"~", "!~"} else value
    if predicates:
        query += " WHERE " + " AND ".join(predicates)
    if order is not None:
        field, *rest = order.split(":")
        direction = rest[0] if rest else "asc"
        if direction not in {"asc", "desc"}:
            raise GrocyError(f"Invalid sort order {direction}", code=None)
        if field not in allowed:
            raise GrocyError(f"Invalid sort field {field}", code=None)
        query += f' ORDER BY "{field}" {direction.upper()}'
    if limit is not None or offset is not None:
        query += " LIMIT :limit OFFSET :offset"
        parameters.update(limit=limit if limit is not None else -1, offset=offset or 0)
    result = await session.execute(text(query), parameters)
    return [dict(row) for row in result.mappings()]
