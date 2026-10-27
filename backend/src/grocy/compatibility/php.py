"""PHP 8 value rules and errors used by the pinned Grocy controllers."""

import json
import math
import re
import sys
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from types import FrameType
from typing import Any

from fastapi import Request, Response

from grocy.compatibility.sanitizer import clean
from grocy.core.actor import Actor
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone

INT_MIN = -(2**63)
INT_MAX = 2**63 - 1
_WHITESPACE = " \t\n\r\v\f"
_FILTER_WHITESPACE = " \t\r\v\n"
_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_INTEGER = re.compile(r"[+-]?[0-9]+")
_FILTER_INTEGER = re.compile(r"[+-]?(?:0|[1-9][0-9]*)")
_DATE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_DATETIME = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})")
_TRUE = frozenset({"1", "true", "on", "yes"})
_PACKAGE = str(Path(__file__).parents[1])


def _failure(message: str, status_code: int, frame: FrameType) -> GrocyError:
    trace = []
    caller: FrameType | None = frame
    while caller is not None:
        if caller.f_code.co_filename.startswith(_PACKAGE):
            trace.append(
                f"#{len(trace)} {caller.f_code.co_filename}({caller.f_lineno}): "
                f"{caller.f_code.co_name}()"
            )
        caller = caller.f_back
    trace.append(f"#{len(trace)} {{main}}")
    return GrocyError(
        message,
        status_code=status_code,
        code=None,
        details={
            "stack_trace": "\n".join(trace),
            "file": frame.f_code.co_filename,
            "line": frame.f_lineno,
        },
    )


def php_error(message: str, *, status_code: int = 500) -> GrocyError:
    return _failure(message, status_code, sys._getframe(1))


def _argument_error(
    function: str, position: int, name: str, expected: str, value: Any, frame: FrameType
) -> GrocyError:
    return _failure(
        f"{function}(): Argument #{position} (${name}) must be of type {expected}, "
        f"{type_name(value)} given, called in {frame.f_code.co_filename} "
        f"on line {frame.f_lineno}",
        500,
        frame,
    )


def argument_error(
    function: str, position: int, name: str, expected: str, value: Any
) -> GrocyError:
    return _argument_error(function, position, name, expected, value, sys._getframe(1))


def type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, (list, dict)):
        return "array"
    return "string"


def php_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "surrogateescape")
    if math.isnan(value):
        return "NAN"
    if math.isinf(value):
        return "INF" if value > 0 else "-INF"
    number = format(value, ".14G")
    if "E" not in number:
        return number
    mantissa, exponent = number.split("E")
    if "." not in mantissa:
        mantissa += ".0"
    return f"{mantissa}E{int(exponent):+d}"


def pdo_parameter(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return "Array"
    return php_string(value)


def purified(value: Any) -> Any:
    if isinstance(value, (bool, list, dict)):
        return value
    if isinstance(value, int) and not INT_MIN <= value <= INT_MAX:
        return php_string(float(value) if abs(value) < 2**1023 else math.copysign(math.inf, value))
    return clean(php_string(value))


def _numeric_prefix(value: str) -> str | None:
    match = _NUMBER.match(value.lstrip(_WHITESPACE))
    return None if match is None else match.group()


def _number(text: str) -> int | float:
    if _INTEGER.fullmatch(text):
        number = int(text)
        if INT_MIN <= number <= INT_MAX:
            return number
    return float(text)


def is_numeric(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    return isinstance(value, str) and _NUMBER.fullmatch(value.strip(_WHITESPACE)) is not None


def numeric_value(value: Any) -> int | float:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    prefix = _numeric_prefix(php_string(value))
    return 0 if prefix is None else _number(prefix)


def intval(value: Any) -> int:
    if isinstance(value, (list, dict)):
        return 1 if value else 0
    number = numeric_value(value)
    if isinstance(number, int):
        return number
    if not math.isfinite(number):
        return 0
    if not INT_MIN <= number < 2**63:
        return INT_MAX if number > 0 else INT_MIN
    return int(number)


def coerced_int(value: str) -> int | None:
    prefix = _numeric_prefix(value)
    if prefix is None:
        return None
    number = _number(prefix)
    if isinstance(number, int):
        return number
    if not math.isfinite(number) or not INT_MIN <= number < 2**63:
        return None
    return int(number)


def coerced_float(value: str) -> float | None:
    prefix = _numeric_prefix(value)
    return None if prefix is None else float(prefix)


def int_argument(value: str, function: str, name: str, position: int = 1) -> int:
    number = coerced_int(value)
    if number is None:
        raise _argument_error(function, position, name, "int", value, sys._getframe(1))
    return number


def filter_int(value: str) -> int | None:
    text = value.strip(_FILTER_WHITESPACE)
    if _FILTER_INTEGER.fullmatch(text) is None:
        return None
    number = int(text)
    return number if INT_MIN <= number <= INT_MAX else None


def filter_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (list, dict)) or value is None:
        return False
    return php_string(value).strip(_FILTER_WHITESPACE).lower() in _TRUE


def empty(value: Any) -> bool:
    if isinstance(value, str):
        return value in ("", "0")
    return not value


def truthy(value: Any) -> bool:
    return not empty(value)


def loose_equals(left: Any, right: Any) -> bool:
    if left is None or right is None:
        other = right if left is None else left
        return other is None or (other == "" if isinstance(other, str) else not other)
    if isinstance(left, bool) or isinstance(right, bool):
        return truthy(left) == truthy(right)
    if isinstance(left, str) and isinstance(right, str):
        if is_numeric(left) and is_numeric(right):
            return _number(left.strip(_WHITESPACE)) == _number(right.strip(_WHITESPACE))
        return left == right
    if isinstance(left, (int, float)) and isinstance(right, str):
        left, right = right, left
    if isinstance(left, str) and isinstance(right, (int, float)):
        if is_numeric(left):
            return _number(left.strip(_WHITESPACE)) == right
        return left == php_string(right)
    return left == right


def identical(left: Any, right: Any) -> bool:
    return type(left) is type(right) and left == right


def find(rows: list[dict[str, Any]], key: str, value: Any) -> dict[str, Any] | None:
    return next((row for row in rows if loose_equals(row.get(key), value)), None)


def php_round(value: Any) -> float:
    number = float(numeric_value(value))
    if not math.isfinite(number):
        return number
    rounded = float(Decimal(repr(number)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return math.copysign(rounded, number) if rounded == 0 else rounded


def _days_in_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _valid_date(year: int, month: int, day: int) -> bool:
    return 1 <= month <= 12 and 1 <= day <= _days_in_month(year, month)


def _format_argument(value: Any) -> str:
    if isinstance(value, (list, dict)):
        raise _failure(
            "DateTime::createFromFormat(): Argument #2 ($datetime) must be of type string, "
            "array given",
            500,
            sys._getframe(2),
        )
    return php_string(value)


def is_iso_date(value: Any) -> bool:
    match = _DATE.fullmatch(_format_argument(value))
    return match is not None and _valid_date(*map(int, match.groups()))


def is_iso_datetime(value: Any) -> bool:
    match = _DATETIME.fullmatch(_format_argument(value))
    if match is None:
        return False
    year, month, day, hour, minute, second = map(int, match.groups())
    return _valid_date(year, month, day) and hour < 24 and minute < 60 and second < 60


def php_date() -> str:
    return datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S")


def require_permission(actor: Actor, permission: str, *, caught: bool = False) -> None:
    if actor.is_admin or permission in actor.permissions:
        return
    if caught:
        raise GrocyError(f"Permission missing: {permission}", code=None)
    raise _failure(f"Permission missing: {permission}", 403, sys._getframe(1))


def _reject_constant(name: str) -> Any:
    raise ValueError(name)


async def request_body(request: Request, *, caught: bool = False) -> dict[Any, Any] | None:
    if ", ".join(request.headers.getlist("content-type")) != "application/json":
        if caught:
            raise GrocyError("Bad Content-Type", code=None)
        raise _failure("Bad Content-Type", 400, sys._getframe(1))
    return parse_request_body(await request.body())


def _valid_json_strings(value: Any, depth: int = 0) -> bool:
    if depth >= 512:
        return False
    if isinstance(value, str):
        value.encode()
    elif isinstance(value, dict):
        return all(
            _valid_json_strings(key, depth + 1) and _valid_json_strings(item, depth + 1)
            for key, item in value.items()
        )
    elif isinstance(value, list):
        return all(_valid_json_strings(item, depth + 1) for item in value)
    return True


def _json_integer(value: str) -> int | float:
    parsed = int(value)
    return parsed if INT_MIN <= parsed <= INT_MAX else float(value)


def parse_request_body(raw: bytes, *, filter_values: bool = True) -> dict[Any, Any] | None:
    try:
        body = json.loads(raw, parse_constant=_reject_constant, parse_int=_json_integer)
        if not _valid_json_strings(body):
            return None
    except (ValueError, RecursionError):
        return None
    if isinstance(body, list):
        body = dict(enumerate(body))
    if not isinstance(body, dict):
        return None
    return {key: purified(value) for key, value in body.items()} if filter_values else body


def body_array(body: dict[Any, Any] | None) -> dict[Any, Any]:
    if body is None:
        raise _failure(
            "array_key_exists(): Argument #2 ($array) must be of type array, null given",
            500,
            sys._getframe(1),
        )
    return body


def php_json(value: Any) -> bytes:
    try:
        if not _valid_json_strings(value):
            return b""
        text = json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            allow_nan=False,
            default=lambda item: (item.decode() or None) if isinstance(item, bytes) else str(item),
        )
    except (TypeError, ValueError):
        return b""
    return text.replace("/", "\\/").encode()


class PhpJSONResponse(Response):
    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        body = php_json(content)
        if not body:
            raise php_error("fwrite(): Argument #2 ($data) must be of type string, false given")
        return body
