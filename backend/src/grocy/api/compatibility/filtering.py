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
        match = regex.search(
            r"([A-Za-z_][A-Za-z0-9_]+)(!?(?:>=|<=|=|~|<|>|§))"
            r"([A-Za-z\p{L}\p{M}0-9*_.$#^| -\\]+)",
            query,
        )
        if not match:
            raise GrocyError("Invalid query", code="invalid_query")
        field, op, raw = match.groups()
        if op not in {"=", "!=", "~", "!~", "<", ">", "<=", ">=", "§"}:
            # The PHP parser accepts these negated operators but its switch ignores them.
            continue
        if fields and field not in fields:
            raise GrocyError("Unknown query field", code="invalid_query")

        def matches(row: dict, field=field, raw=raw, op=op) -> bool:
            value = row.get(field)
            if raw.lower() == "null" and op in {"=", "!="} and value is None:
                return True
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
                pattern = ".*".join(
                    ".".join(re.escape(part) for part in segment.split("_"))
                    for segment in raw.split("%")
                )
                # SQLite LIKE folds ASCII letters only and keeps '_' as a wildcard.
                found = (
                    re.search(pattern, str(value), re.IGNORECASE | re.ASCII | re.DOTALL) is not None
                )
                return found if op == "~" else not found
            left, right = str(value), raw
            if isinstance(value, (int, float, Decimal)):
                with suppress(InvalidOperation):
                    left, right = (
                        Decimal(str(int(value) if isinstance(value, bool) else value)),
                        Decimal(raw),
                    )
                if isinstance(left, str):
                    # A numeric SQLite column sorts before a nonnumeric TEXT parameter.
                    return op in {"!=", "<", "<="}
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
            rows,
            key=lambda r: (
                0
                if r.get(field) is None
                else 1
                if isinstance(r.get(field), (int, float, Decimal))
                else 2,
                r.get(field),
            ),
            reverse=direction == "desc",
        )
    try:
        offset = int(params.get("offset", 0))
        limit = int(params.get("limit", -1))
        if offset < 0 or limit < -1:
            raise ValueError
    except ValueError as exc:
        raise GrocyError("Invalid limit or offset", code="invalid_query") from exc
    return rows[offset:] if limit == -1 else rows[offset : offset + limit]
