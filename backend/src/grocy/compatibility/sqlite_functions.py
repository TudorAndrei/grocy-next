import math
from functools import lru_cache
from typing import Any

import regex


@lru_cache(maxsize=256)
def _compile(pattern: str) -> regex.Pattern:
    return regex.compile(pattern, regex.VERSION1)


def regexp(pattern: Any, value: Any) -> int:
    try:
        if isinstance(pattern, bytes):
            pattern = pattern.decode()
        else:
            pattern = "" if pattern is None else str(pattern)
        value = value.decode() if isinstance(value, bytes) else "" if value is None else str(value)
        return int(_compile(pattern).search(value, timeout=1) is not None)
    except (regex.error, UnicodeDecodeError, TimeoutError):
        return 0


def ceil(value: Any) -> float:
    number = float(value) if value is not None else 0.0
    return float(math.ceil(number)) if math.isfinite(number) else number


def register_sqlite_functions(database: Any) -> None:
    database.create_function("regexp", 2, regexp, deterministic=True)
    database.create_function("ceil", 1, ceil, deterministic=True)
