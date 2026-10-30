"""Quantity-unit translations use PHP number comparisons and integer remainders."""

import gettext
import math
import re
from functools import lru_cache
from typing import Any

from grocy.compatibility.php import empty
from grocy.compatibility.sprintf import sprintf_number


class _QuantityCount(int):
    value: float

    def __new__(cls, value: float):
        value = float(value)
        integer = int(value) % 2**64 if math.isfinite(value) else 0
        if integer >= 2**63:
            integer -= 2**64
        count = super().__new__(cls, integer)
        count.value = value
        return count

    def __mod__(self, other: int) -> int:
        remainder = abs(int(self)) % abs(other)
        return -remainder if int(self) < 0 else remainder

    def __eq__(self, other: object) -> bool:
        return self.value == other

    def __ne__(self, other: object) -> bool:
        return self.value != other

    def __lt__(self, other: int) -> bool:
        return self.value < other

    def __le__(self, other: int) -> bool:
        return self.value <= other

    def __gt__(self, other: int) -> bool:
        return self.value > other

    def __ge__(self, other: int) -> bool:
        return self.value >= other


@lru_cache
def _plural(header: str):
    count = re.search(r"nplurals\s*=\s*(\d+)", header)
    expression = re.search(r"plural\s*=\s*([^;]+)", header)
    return int(count[1]) if count else 2, gettext.c2py(expression[1] if expression else "n != 1")


def quantity_label(
    amount: int | float,
    name: str | None,
    plural: str | None,
    forms: str | None,
    active: int | None,
    header: str | None,
) -> str:
    name = name or ""
    plural = name if empty(plural) else plural
    index = 0 if abs(amount) == 1 else 1
    if active == 1 and header:
        count, choose = _plural(header)
        index = choose(_QuantityCount(abs(amount)))
        if count <= 2:
            index = int(bool(index))
    labels = [name, *re.split(r"\r\n|\r|\n", forms or "")] if active == 1 else []
    message = (
        labels[index]
        if 0 <= index < len(labels) and labels[index] != ""
        else name
        if index == 0
        else plural
    )
    return sprintf_number(message or "", amount)


def catalog_quantity_label(
    amount: int | float, name: str | None, plural: str | None, catalog: dict[str, Any]
) -> str:
    """The native overview's own amount uses the general translation domain."""
    name = name or ""
    plural = name if empty(plural) else plural
    labels = catalog["messages"].get("", {}).get(name)
    index = 0 if abs(amount) == 1 else 1
    if labels is not None and catalog["plural-forms"]:
        count, choose = _plural(catalog["plural-forms"])
        index = choose(_QuantityCount(abs(amount)))
        if count <= 2:
            index = int(bool(index))
    message = (
        labels[index]
        if labels and 0 <= index < len(labels) and labels[index]
        else name
        if index == 0
        else plural
    )
    return sprintf_number(message or "", amount)
