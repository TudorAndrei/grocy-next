"""Carry SQLite values through JSON without losing blobs or IEEE values."""

import base64
import math
from typing import Any


def encode_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"binary": base64.b64encode(value).decode("ascii")}
    if isinstance(value, float) and not math.isfinite(value):
        return {"nonfinite": "nan" if math.isnan(value) else "inf" if value > 0 else "-inf"}
    return value


def decode_value(value: Any) -> Any:
    if isinstance(value, dict) and "binary" in value:
        return base64.b64decode(value["binary"])
    if isinstance(value, dict) and "nonfinite" in value:
        return float(value["nonfinite"])
    return value
