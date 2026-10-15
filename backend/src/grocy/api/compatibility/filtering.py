import operator
import re
from contextlib import suppress
from decimal import Decimal, InvalidOperation
from typing import Any

import regex
from starlette.datastructures import QueryParams

from grocy.core.errors import GrocyError


def filter_rows(rows: list[dict[str, Any]], params: QueryParams) -> list[dict[str, Any]]:
    queries = [v for k, v in params.multi_items() if k == "query" or k.startswith("query[")]
    fields = set().union(*(row.keys() for row in rows))
    for query in queries:
        match = re.fullmatch(r"([a-zA-Z_][\w]*)(!=|!~|<=|>=|=|~|<|>|§)(.*)", query)
        if not match:
            raise GrocyError("Invalid query", code="invalid_query")
        field, op, raw = match.groups()
        if fields and field not in fields:
            raise GrocyError("Unknown query field", code="invalid_query")

        def matches(row: dict, field=field, raw=raw, op=op) -> bool:
            value = row.get(field)
            if raw.lower() == "null":
                return value is None if op == "=" else value is not None
            if value is None:
                return False
            if op == "§":
                if len(raw) > 256:
                    raise GrocyError("Regular expression is too long")
                try:
                    return regex.search(raw, str(value)[:4096], timeout=0.05) is not None
                except (regex.error, TimeoutError) as exc:
                    raise GrocyError("Invalid regular expression") from exc
            if op in {"~", "!~"}:
                found = raw.casefold() in str(value).casefold()
                return found if op == "~" else not found
            left, right = str(value), raw
            with suppress(InvalidOperation):
                left, right = (
                    Decimal(str(int(value) if isinstance(value, bool) else value)),
                    Decimal(raw),
                )
            compare = {
                "=": operator.eq,
                "!=": operator.ne,
                "<": operator.lt,
                ">": operator.gt,
                "<=": operator.le,
                ">=": operator.ge,
            }[op]
            return compare(left, right)

        rows = [row for row in rows if matches(row)]
    if order := params.get("order"):
        field, _, direction = order.partition(":")
        if (fields and field not in fields) or direction not in {"", "asc", "desc"}:
            raise GrocyError("Invalid sort order", code="invalid_query")
        rows = sorted(
            rows, key=lambda r: (r.get(field) is None, r.get(field)), reverse=direction == "desc"
        )
    try:
        offset = int(params.get("offset", 0))
        limit = int(params.get("limit", -1))
        if offset < 0 or limit < -1:
            raise ValueError
    except ValueError as exc:
        raise GrocyError("Invalid limit or offset", code="invalid_query") from exc
    return rows[offset:] if limit == -1 else rows[offset : offset + limit]
