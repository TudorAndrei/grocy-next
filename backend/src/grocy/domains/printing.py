import asyncio
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError


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
        raise GrocyError("Label printer request failed") from exc


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


async def label(session: AsyncSession, entity: str, object_id: int) -> dict[str, Any]:
    from grocy.domains.catalog.objects import GenericObjectsService
    from grocy.domains.household.service import HouseholdService
    from grocy.domains.stock.service import StockService

    try:
        details = await GenericObjectsService(session).get_entity(entity, object_id)
    except NotFoundError as exc:
        if entity == "recipes":
            payload = {
                "recipe": None,
                "grocycode": f"grcy:r:{object_id}",
                "details": None,
                **get_settings().label_printer_params,
            }
            await send_label(payload)
            return payload
        messages = {
            "products": "Product does not exist or is inactive",
            "chores": "Chore does not exist",
            "batteries": "Battery does not exist",
            "stock": "Stock entry does not exist",
        }
        raise GrocyError(messages[entity], status_code=500 if entity == "stock" else 400) from exc
    kind, code = {
        "products": ("product", "p"),
        "chores": ("chore", "c"),
        "batteries": ("battery", "b"),
        "recipes": ("recipe", "r"),
        "stock": ("product", "p"),
    }[entity]
    product_id = details.get("product_id", object_id) if entity == "stock" else object_id
    name = details.get("name", "")
    if entity == "chores":
        details = await HouseholdService(session).get_chore(object_id)
        details = {
            key: value
            for key, value in details.items()
            if key not in {"last_tracked_time", "track_count"}
        }
        details["chore"] = _DatabaseRow(details["chore"])
    elif entity == "batteries":
        details = await HouseholdService(session).get_battery(object_id)
        details.pop("last_tracked_time", None)
        details["battery"] = _DatabaseRow(details["battery"])
    elif entity == "recipes":
        details = _DatabaseRow(
            {
                key: value
                for key, value in details.items()
                if key not in {"positions", "not_check_stock_fulfillment"}
            }
        )
    stock_entry = details if entity == "stock" else None
    if entity in {"stock", "products"}:
        details = await StockService(session).product_details(product_id, compatibility=True)
        details = _stock_details(details)
        name = details["product"]["name"]
    grocycode = f"grcy:{code}:{product_id}"
    if stock_entry is not None:
        grocycode += f":{stock_entry['stock_id']}"
    payload = {kind: name, "grocycode": grocycode, "details": details}
    if stock_entry is not None:
        payload["stock_entry"] = _DatabaseRow(stock_entry)
    payload.update(get_settings().label_printer_params)
    if stock_entry is not None and get_settings().feature_enabled(
        "STOCK_BEST_BEFORE_DATE_TRACKING"
    ):
        payload["due_date"] = f"DD: {stock_entry['best_before_date']}"
    await send_label(payload)
    return payload
