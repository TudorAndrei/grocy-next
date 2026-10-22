import asyncio
import os
import socket
import unicodedata
import zlib
from contextlib import suppress
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.php import (
    loose_equals,
    numeric_value,
    pdo_parameter,
    php_round,
    php_string,
    truthy,
)
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone

_ESCPOS_CHARACTERS = (
    Path(__file__).parents[1]
    / "_vendor"
    / "mike42-escpos-php"
    / "src"
    / "Mike42"
    / "Escpos"
    / "PrintBuffers"
    / "cache"
    / "Characters-default.ser.z"
)
_ESC = b"\x1b"
_GS = b"\x1d"
_JUSTIFY_LEFT = 0
_JUSTIFY_CENTER = 1
_MODE_FONT_A = 0
_MODE_DOUBLE_WIDTH = 32
_CUT_FULL = 65
_CONNECT_TIMEOUT = 60


def automatic_stock_labels_enabled() -> bool:
    settings = get_settings()
    return settings.feature_enabled("LABEL_PRINTER") and settings.label_printer_runs_on_server()


class _DatabaseRow(dict[str, Any]):
    """Grocy database rows have JSON fields but no public PHP form fields."""


def _stock_details(details: dict[str, Any]) -> dict[str, Any]:
    row_keys = {
        "product",
        "quantity_unit_stock",
        "default_quantity_unit_purchase",
        "default_quantity_unit_consume",
        "quantity_unit_price",
        "location",
        "default_consume_location",
    }
    result = {
        key: _DatabaseRow(value) if key in row_keys and isinstance(value, dict) else value
        for key, value in details.items()
    }
    result["product_barcodes"] = [_DatabaseRow(row) for row in details["product_barcodes"]]
    return result


def _form_values(value: Any, name: str) -> list[tuple[str, str]]:
    if isinstance(value, _DatabaseRow):
        return []
    if isinstance(value, dict):
        return [
            pair for key, item in value.items() for pair in _form_values(item, f"{name}[{key}]")
        ]
    if isinstance(value, list):
        return [
            pair for key, item in enumerate(value) for pair in _form_values(item, f"{name}[{key}]")
        ]
    if value is None:
        return []
    if isinstance(value, bool):
        return [(name, "1" if value else "0")]
    if isinstance(value, float):
        number = format(value, ".14g")
        if "e" in number:
            mantissa, exponent = number.split("e")
            if "." not in mantissa:
                mantissa += ".0"
            number = f"{mantissa}E{int(exponent):+d}"
        return [(name, number)]
    return [(name, str(value))]


async def send_label(payload: dict[str, Any]) -> None:
    settings = get_settings()
    if not settings.label_printer_runs_on_server():
        return
    hook_json = settings.label_printer_hook_json
    options: dict[str, Any]
    if hook_json is not False and hook_json not in ("", "0"):
        options = {"json": payload}
    else:
        fields = [pair for name, value in payload.items() for pair in _form_values(value, name)]
        options = {
            "content": urlencode(fields).replace("~", "%7E"),
            "headers": {"Content-Type": "application/x-www-form-urlencoded"},
        }
    try:
        async with (
            asyncio.timeout(2),
            httpx.AsyncClient(timeout=2, follow_redirects=True, max_redirects=5) as client,
        ):
            response = await client.post(settings.label_printer_webhook, **options)
            if 400 <= response.status_code < 600:
                response.raise_for_status()
    except (httpx.HTTPError, httpx.InvalidURL, TimeoutError) as exc:
        raise GrocyError("Label printer request failed", code=None) from exc


async def stock_label(
    product_id: int, details: dict[str, Any], entry: dict[str, Any], due_date: str | None
) -> dict[str, Any]:
    payload = {
        "product": details["product"]["name"],
        "grocycode": f"grcy:p:{product_id}:{entry['stock_id']}",
        "details": _stock_details(details),
        "stock_entry": _DatabaseRow(entry),
        **get_settings().label_printer_params,
    }
    if get_settings().feature_enabled("STOCK_BEST_BEFORE_DATE_TRACKING"):
        payload["due_date"] = f"DD: {due_date or ''}"
    await send_label(payload)
    return payload


def _rows_in(details: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any]:
    return {
        key: _DatabaseRow(value) if key in names and isinstance(value, dict) else value
        for key, value in details.items()
    }


async def _object_label(
    kind: str, code: str, identifier: str, name: Any, details: Any
) -> dict[str, Any]:
    payload = {
        kind: name,
        "grocycode": f"grcy:{code}:{identifier}",
        "details": details,
        **get_settings().label_printer_params,
    }
    await send_label(payload)
    return payload


async def chore_label(chore_id: str, details: dict[str, Any]) -> dict[str, Any]:
    rows = _rows_in(details, ("chore", "last_done_by", "next_execution_assigned_user"))
    return await _object_label("chore", "c", chore_id, details["chore"]["name"], rows)


async def battery_label(battery_id: str, details: dict[str, Any]) -> dict[str, Any]:
    rows = _rows_in(details, ("battery",))
    return await _object_label("battery", "b", battery_id, details["battery"]["name"], rows)


async def _rows(session: AsyncSession, statement: str, *parameters: Any) -> list[dict[str, Any]]:
    connection = await session.connection()
    result = await connection.exec_driver_sql(statement, parameters)
    return [dict(row) for row in result.mappings()]


async def recipe_label(session: AsyncSession, recipe_id: str) -> dict[str, Any]:
    recipes = await _rows(session, "SELECT * FROM `recipes` WHERE `id` = ?", recipe_id)
    if not recipes:
        return await _object_label("recipe", "r", recipe_id, None, None)
    recipe = recipes[0]
    return await _object_label("recipe", "r", recipe_id, recipe["name"], _DatabaseRow(recipe))


def _unserialize(data: bytes, position: int) -> tuple[Any, int]:
    kind = data[position : position + 1]
    if kind == b"i":
        end = data.index(b";", position)
        return int(data[position + 2 : end]), end + 1
    colon = data.index(b":", position + 2)
    size = int(data[position + 2 : colon])
    if kind == b"s":
        start = colon + 2
        return data[start : start + size].decode(), start + size + 2
    position = colon + 2
    values: dict[Any, Any] = {}
    for _ in range(size):
        key, position = _unserialize(data, position)
        values[key], position = _unserialize(data, position)
    return values, position + 1


@lru_cache
def _character_tables() -> tuple[dict[int, int], dict[int, dict[int, int]]]:
    tables, _ = _unserialize(zlib.decompress(_ESCPOS_CHARACTERS.read_bytes()), 0)
    return tables["available"], tables["encode"]


class _EscposPrinter:
    def __init__(self) -> None:
        self.data = bytearray(_ESC + b"@")
        self.table = 0

    def text(self, value: str) -> None:
        available, encode = _character_tables()
        table = self.table
        block: list[int] = []
        for character in unicodedata.normalize("NFC", value):
            point = ord(character)
            if point not in available or point in encode.get(table, {}):
                block.append(point)
            else:
                self._write(block, table)
                table = available[point]
                block = [point]
        if block:
            self._write(block, table)

    def _write(self, points: list[int], table: int) -> None:
        mapping = _character_tables()[1].get(table, {})
        raw = bytearray()
        for point in points:
            if point in mapping:
                raw.append(mapping[point])
            elif 31 < point < 127 or point == 10:
                raw.append(point)
            elif point != 13:
                raw += b"?"
        if self.table != table:
            self.data += _ESC + b"t" + bytes([table])
            self.table = table
        self.data += raw

    def feed(self, lines: int = 1) -> None:
        self.data += b"\n" if lines <= 1 else _ESC + b"d" + bytes([lines])

    def justify(self, justification: int) -> None:
        self.data += _ESC + b"a" + bytes([justification])

    def mode(self, mode: int) -> None:
        self.data += _ESC + b"!" + bytes([mode])

    def size(self, width: int, height: int) -> None:
        self.data += _GS + b"!" + bytes([16 * (width - 1) + height - 1])

    def reverse(self, enabled: bool) -> None:
        self.data += _GS + b"B" + bytes([1 if enabled else 0])

    def cut(self) -> None:
        self.data += _GS + b"V" + bytes([_CUT_FULL, 3])


def _shopping_list_output(print_header: bool, lines: list[str]) -> bytes:
    printer = _EscposPrinter()
    if print_header:
        printer.justify(_JUSTIFY_CENTER)
        printer.mode(_MODE_DOUBLE_WIDTH)
        printer.size(4, 4)
        printer.reverse(True)
        printer.text("Grocy")
        printer.justify(_JUSTIFY_LEFT)
        printer.size(1, 1)
        printer.reverse(False)
        printer.feed(2)
        printer.text(datetime.now(server_timezone()).strftime("%d/%m/%Y %H:%M"))
        printer.mode(_MODE_FONT_A)
        printer.feed(2)
    for line in lines:
        printer.text(line)
        printer.feed()
    printer.feed(3)
    printer.cut()
    return bytes(printer.data)


def _list_parameter(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    if any(isinstance(key, str) for key in value):
        raise GrocyError(
            "SQLSTATE[HY093]: Invalid parameter number: parameter was not defined", code=None
        )
    if list(value) != [0]:
        raise GrocyError("SQLSTATE[HY000]: General error: 25 column index out of range", code=None)
    return value[0]


async def shopping_list_lines(session: AsyncSession, list_id: Any) -> list[str]:
    identifier = pdo_parameter(_list_parameter(list_id))
    if not await _rows(session, "SELECT * FROM `shopping_lists` WHERE (id = ?)", identifier):
        raise GrocyError("Shopping list does not exist", code=None)
    configuration = get_settings().thermal_printer_configuration()
    print_notes = truthy(configuration["TPRINTER_PRINT_NOTES"])
    print_names = truthy(configuration["TPRINTER_PRINT_QUANTITY_NAME"])
    quantities: list[str] = []
    products: list[str] = []
    items = await _rows(
        session, "SELECT * FROM `uihelper_shopping_list` WHERE (shopping_list_id = ?)", identifier
    )
    for item in items:
        valid = not loose_equals(item["product_id"], None) and not loose_equals(
            item["product_id"], ""
        )
        amount = 0.0
        note = ""
        if valid:
            product = next(
                iter(
                    await _rows(
                        session,
                        "SELECT * FROM `products` WHERE (id = ?)",
                        pdo_parameter(item["product_id"]),
                    )
                ),
                None,
            )
            conversions = await _rows(
                session,
                "SELECT * FROM `cache__quantity_unit_conversions_resolved` "
                "WHERE (product_id = ? AND from_qu_id = ? AND to_qu_id = ?)",
                pdo_parameter(None if product is None else product["id"]),
                pdo_parameter(None if product is None else product["qu_id_stock"]),
                pdo_parameter(item["qu_id"]),
            )
            factor = conversions[0]["factor"] if conversions else 1.0
            amount = php_round(numeric_value(item["amount"]) * numeric_value(factor))
            if print_notes and not loose_equals(item["note"], ""):
                note = " (" + php_string(item["note"]) + ")"
        if valid:
            quantity = php_string(amount)
            if print_names:
                unit = item["qu_name_plural"] if amount > 1 else item["qu_name"]
                quantity += " " + php_string(unit)
            quantities.append(quantity)
            products.append(php_string(item["product_name"]) + note)
        else:
            quantities.append(php_string(php_round(item["amount"])))
            products.append(php_string(item["note"]))
    width = max([1, *(len(quantity.encode()) for quantity in quantities)])
    return [
        quantity + " " * (width - len(quantity.encode())) + "  " + product
        for quantity, product in zip(quantities, products, strict=True)
    ]


def _connection_error(error: OSError) -> str:
    if isinstance(error, TimeoutError):
        return "Connection timed out"
    if isinstance(error, socket.gaierror) or error.errno is None:
        return error.strerror or str(error)
    return os.strerror(error.errno)


def _write_device(path: str, data: bytes) -> None:
    try:
        with Path(path).open("wb+") as device:
            device.write(data)
    except OSError as error:
        raise GrocyError("Cannot initialise FilePrintConnector.", code=None) from error


async def _send_to_printer(data: bytes) -> None:
    configuration = get_settings().thermal_printer_configuration()
    if not truthy(configuration["TPRINTER_IS_NETWORK_PRINTER"]):
        await run_in_threadpool(
            _write_device, php_string(configuration["TPRINTER_CONNECTOR"]), data
        )
        return
    try:
        async with asyncio.timeout(_CONNECT_TIMEOUT):
            _reader, writer = await asyncio.open_connection(
                php_string(configuration["TPRINTER_IP"]), int(configuration["TPRINTER_PORT"])
            )
    except OSError as error:
        raise GrocyError(
            "Cannot initialise NetworkPrintConnector: " + _connection_error(error), code=None
        ) from error
    try:
        writer.write(data)
        with suppress(OSError):
            await writer.drain()
    finally:
        writer.close()
        with suppress(OSError):
            await writer.wait_closed()


async def print_shopping_list(
    session: AsyncSession, list_id: Any, print_header: bool
) -> dict[str, str]:
    lines = await shopping_list_lines(session, list_id)
    await _send_to_printer(_shopping_list_output(print_header, lines))
    return {"result": "OK"}


async def product_label(details: dict[str, Any]) -> dict[str, Any]:
    product = details["product"]
    return await _object_label(
        "product", "p", php_string(product["id"]), product["name"], _stock_details(details)
    )


async def stock_entry(session: AsyncSession, entry_id: str) -> dict[str, Any] | None:
    entries = await _rows(session, "SELECT * FROM `stock` WHERE `id` = ?", entry_id)
    return entries[0] if entries else None
