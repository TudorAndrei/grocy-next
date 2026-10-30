"""PHP's one-number sprintf contract used by quantity-unit labels."""

import math
import re

from grocy.compatibility.php import php_string
from grocy.core.errors import GrocyError

_LIMIT = 2**31 - 1
_DIGITS = re.compile(rb"[0-9]+")
_POSITION_ERROR = "Argument number specifier must be greater than zero and less than 2147483647"


def _size(value: bytes) -> int:
    value = value.lstrip(b"0")
    return _LIMIT + 1 if len(value) > 10 else int(value or b"0")


def _error(message: str) -> GrocyError:
    return GrocyError(message, status_code=500, code=None)


def _integer(value: int | float) -> int:
    integer = int(value) % 2**64 if math.isfinite(value) else 0
    return integer - 2**64 if integer >= 2**63 else integer


def _float(value: int | float, kind: str, precision: int | None) -> str:
    precision = min(53, 6 if precision is None else precision)
    number = float(value)
    if number == 0 and kind in "eEfF":
        number = 0.0
    style = kind.lower() if kind in "eEfF" else "g"
    result = format(number, f".{precision}{style}")
    if "e" in result:
        mantissa, exponent = result.split("e")
        if style == "g" and "." not in mantissa:
            mantissa += ".0"
        result = mantissa + ("E" if kind in "EGH" else "e") + f"{int(exponent):+d}"
    return result


def sprintf_number(message: str, value: int | float) -> str:
    source = message.encode()
    output = bytearray()
    cursor, argument = 0, 1
    while cursor < len(source):
        if source[cursor] != 37:
            output.append(source[cursor])
            cursor += 1
            continue
        cursor += 1
        if cursor < len(source) and source[cursor] == 37:
            output.append(37)
            cursor += 1
            continue
        position = argument
        digits = _DIGITS.match(source, cursor)
        explicit = bool(digits and source[digits.end() : digits.end() + 1] == b"$")
        if explicit:
            position = _size(digits[0])
            if not 0 < position < _LIMIT:
                raise _error(_POSITION_ERROR)
            cursor = digits.end() + 1
        else:
            argument += 1
        left, plus, pad = False, False, 32
        while cursor < len(source) and source[cursor] in b"-+ 0'":
            flag = source[cursor]
            cursor += 1
            if flag == 45:
                left = True
            elif flag == 43:
                plus = True
            elif flag == 48:
                pad = 48
            elif flag == 39 and cursor < len(source):
                pad = source[cursor]
                cursor += 1
        width, precision = 0, None
        for field in ["Width", "Precision"]:
            if field == "Precision":
                if source[cursor : cursor + 1] != b".":
                    break
                cursor += 1
            size = None
            dynamic = False
            digits = _DIGITS.match(source, cursor)
            if digits:
                size = _size(digits[0])
                cursor = digits.end()
            elif source[cursor : cursor + 1] == b"*":
                dynamic = True
                cursor += 1
                slot = _DIGITS.match(source, cursor)
                if slot and source[slot.end() : slot.end() + 1] == b"$":
                    slot_number = _size(slot[0])
                    if not 0 < slot_number < _LIMIT:
                        raise _error(_POSITION_ERROR)
                    cursor = slot.end() + 1
                else:
                    slot_number = argument if explicit else position
                    argument += 1
                    if not explicit:
                        position += 1
                if slot_number != 1:
                    raise _error(f"{slot_number + 1} arguments are required, 2 given")
                if not isinstance(value, int):
                    raise _error(f"{field} must be an integer")
                size = value
            minimum = -1 if dynamic and field == "Precision" else 0
            if size is not None and not minimum <= size <= _LIMIT:
                raise _error(f"{field} must be between {minimum} and 2147483647")
            if field == "Width":
                width = size or 0
            else:
                precision = None if size == -1 else size
        if cursor == len(source):
            raise _error("Missing format specifier at end of string")
        kind = chr(source[cursor])
        cursor += 1
        if position != 1:
            raise _error(f"{position + 1} arguments are required, 2 given")
        if kind == "s":
            result = php_string(value).encode()
            if precision is not None:
                result = result[:precision]
        elif kind == "c":
            result = bytes([_integer(value) % 256])
            width = 0
        elif kind == "%":
            result = b"%"
            width = 0
        elif kind in "duboxX":
            number = _integer(value)
            if kind != "d":
                number %= 2**64
            style = {"d": "d", "u": "d", "b": "b", "o": "o", "x": "x", "X": "X"}[kind]
            result = format(number, style).encode()
            if plus and kind == "d" and number >= 0:
                result = b"+" + result
        elif kind in "eEfFgGhH":
            result = _float(value, kind, precision).encode()
            if plus and not result.startswith(b"-"):
                result = b"+" + result
        else:
            display = bytes([ord(kind)]).decode(errors="replace")
            raise _error(f'Unknown format specifier "{display}"')
        padding = bytes([32 if left and pad == 48 and kind in "du" else pad]) * max(
            0, width - len(result)
        )
        if left:
            output.extend(result + padding)
        elif pad == 48 and kind in "deEfFgGhH" and result[:1] in {b"-", b"+"}:
            output.extend(result[:1] + padding + result[1:])
        else:
            output.extend(padding + result)
    return output.decode(errors="replace")
