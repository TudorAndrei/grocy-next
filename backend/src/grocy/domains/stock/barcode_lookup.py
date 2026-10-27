from __future__ import annotations

import importlib.util
import inspect
import re
import secrets
import string
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility import client_defaults
from grocy.compatibility.input import database_error
from grocy.compatibility.php import empty, is_numeric, loose_equals, php_string
from grocy.compatibility.rows import save_rows
from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.db.models.catalog import Location, Product, QuantityUnit
from grocy.domains.users.service import UsersService
from grocy.plugins import BaseBarcodeLookupPlugin

_OFF_USER_AGENT = "GrocyOpenFoodFactsBarcodeLookupPlugin/1.0 (https://grocy.info)"
_IMAGE_USER_AGENT_PREFIX = "Grocy/"
_REQUIRED = (
    "name",
    "location_id",
    "qu_id_purchase",
    "qu_id_stock",
    "__qu_factor_purchase_to_stock",
    "__barcode",
)
_OPEN_FOOD_FACTS = "OpenFoodFactsBarcodeLookupPlugin"


def _preset_id(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return None if number == -1 else number


def _ascii_name(value: str) -> str:
    return re.sub(r"[^\x20-\x7E]", "", value)


async def _user_settings(session: AsyncSession, user_id: int) -> dict[str, Any]:
    return await UsersService(session).settings(user_id)


async def _locale(session: AsyncSession, user_id: int) -> str:
    settings = await _user_settings(session, user_id)
    locale = settings.get("locale") or get_settings().default_locale
    return str(locale)


async def lookup_open_food_facts(
    session: AsyncSession,
    actor: Actor,
    barcode: str,
) -> dict[str, Any] | None:
    locale = await _locale(session, actor.user_id)
    localized = f"product_name_{locale[:2]}"
    digits = re.sub(r"[^0-9]", "", barcode)
    url = (
        f"https://world.openfoodfacts.org/api/v2/product/{digits}"
        f"?fields=product_name,image_url,{localized}"
    )
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": _OFF_USER_AGENT})
    if response.status_code == 404:
        return None
    try:
        data = response.json()
    except ValueError:
        return None
    if response.status_code != 200 or data.get("status") != 1:
        return None
    product = data.get("product") or {}
    name = product.get(localized) or product.get("product_name") or ""
    name = _ascii_name(str(name))
    image_url = product.get("image_url") or ""

    locations = list(
        (await session.execute(select(Location).where(Location.active == 1).order_by(Location.id)))
        .scalars()
        .all()
    )
    units = list(
        (
            await session.execute(
                select(QuantityUnit).where(QuantityUnit.active == 1).order_by(QuantityUnit.id)
            )
        )
        .scalars()
        .all()
    )
    if not locations or not units:
        raise GrocyError("No locations or quantity units available for barcode lookup")

    user_settings = await _user_settings(session, actor.user_id)
    location_id = _preset_id(user_settings.get("product_presets_location_id")) or locations[0].id
    qu_id = _preset_id(user_settings.get("product_presets_qu_id")) or units[0].id

    return {
        "name": name,
        "location_id": location_id,
        "qu_id_purchase": qu_id,
        "qu_id_stock": qu_id,
        "__qu_factor_purchase_to_stock": 1,
        "__barcode": barcode,
        "__image_url": image_url,
    }


def validate_plugin_output(
    output: dict[str, Any],
    *,
    locations: set[int],
    quantity_units: set[int],
) -> dict[str, Any]:
    if not isinstance(output, dict):
        raise GrocyError("Plugin output must be an associative array", code=None)
    for prop in _REQUIRED:
        if prop not in output:
            raise GrocyError(f"Plugin output does not provide needed property {prop}", code=None)
    location_id = output["location_id"]
    if not any(loose_equals(location_id, identity) for identity in locations):
        raise GrocyError(
            f"Provided location_id ({location_id}) is not a valid location id", code=None
        )
    qu_purchase = output["qu_id_purchase"]
    if not any(loose_equals(qu_purchase, identity) for identity in quantity_units):
        raise GrocyError(
            f"Provided qu_id_purchase ({qu_purchase}) is not a valid quantity unit id",
            code=None,
        )
    qu_stock = output["qu_id_stock"]
    if not any(loose_equals(qu_stock, identity) for identity in quantity_units):
        raise GrocyError(
            f"Provided qu_id_stock ({qu_stock}) is not a valid quantity unit id",
            code=None,
        )
    factor = output["__qu_factor_purchase_to_stock"]
    if empty(factor) or not is_numeric(factor):
        raise GrocyError(
            "Provided __qu_factor_purchase_to_stock is empty or not a number", code=None
        )
    return output


async def _download_image(image_url: str, barcode: str) -> str | None:
    if not image_url:
        return None
    version = client_defaults()["grocy_version"]["Version"]
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(
                image_url,
                headers={"User-Agent": f"{_IMAGE_USER_AGENT_PREFIX}{version} (https://grocy.info)"},
            )
            if response.status_code >= 400:
                return None
            body = response.content
    except httpx.HTTPError:
        return None
    path_part = urlparse(image_url).path
    extension = Path(path_part).suffix.lstrip(".")
    file_name = f"{barcode}.{extension}"
    root = get_settings().files_root.resolve() / "productpictures"
    root.mkdir(parents=True, exist_ok=True)
    target = (root / file_name).resolve()
    if not target.is_relative_to(root):
        return None

    def _write() -> None:
        target.write_bytes(body)

    await run_in_threadpool(_write)
    return file_name


async def create_product_from_lookup(
    session: AsyncSession,
    plugin_output: dict[str, Any],
) -> dict[str, Any]:
    name = plugin_output["name"]
    existing = (
        (await session.execute(select(Product).where(Product.name == name))).scalars().first()
    )
    if existing is not None:
        raise GrocyError(f'Product "{name}" already exists', code=None)

    product_data = {
        key: value
        for key, value in plugin_output.items()
        if key not in {"__barcode", "__qu_factor_purchase_to_stock", "__image_url"}
    }
    picture = await _download_image(
        php_string(plugin_output.get("__image_url") or ""),
        php_string(plugin_output["__barcode"]),
    )
    if picture:
        product_data["picture_file_name"] = picture

    try:
        identity = await save_rows(session, "products", product_data)
        await save_rows(
            session,
            "product_barcodes",
            {"product_id": identity, "barcode": plugin_output["__barcode"]},
        )
        if not loose_equals(plugin_output["qu_id_stock"], plugin_output["qu_id_purchase"]):
            await save_rows(
                session,
                "quantity_unit_conversions",
                {
                    "product_id": identity,
                    "from_qu_id": plugin_output["qu_id_purchase"],
                    "to_qu_id": plugin_output["qu_id_stock"],
                    "factor": plugin_output["__qu_factor_purchase_to_stock"],
                },
            )
    except DBAPIError as error:
        await session.rollback()
        raise database_error(error) from error
    result = dict(plugin_output)
    result["id"] = identity
    return result


def _load_plugin(path: Path, name: str) -> type[BaseBarcodeLookupPlugin]:
    specification = importlib.util.spec_from_file_location("grocy_user_plugin_" + name, path)
    if specification is None or specification.loader is None:
        raise GrocyError(f"Plugin {name} was not found", code=None)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    plugin = getattr(module, name, None)
    if not isinstance(plugin, type) or not issubclass(plugin, BaseBarcodeLookupPlugin):
        raise GrocyError(f"Plugin {name} must extend BaseBarcodeLookupPlugin", code=None)
    return plugin


async def _plugin_output(
    session: AsyncSession,
    actor: Actor,
    name: str,
    barcode: str,
    locations: list[Location],
    units: list[QuantityUnit],
) -> Any:
    path = get_settings().datapath / "plugins" / (name + ".py")
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) and path.is_file():
        try:
            plugin_class = await run_in_threadpool(_load_plugin, path, name)
            plugin = plugin_class(
                [
                    {column.key: getattr(row, column.key) for column in Location.__table__.columns}
                    for row in locations
                ],
                [
                    {
                        column.key: getattr(row, column.key)
                        for column in QuantityUnit.__table__.columns
                    }
                    for row in units
                ],
                await _user_settings(session, actor.user_id),
            )
            result = await run_in_threadpool(plugin.execute_lookup, barcode)
            return await result if inspect.isawaitable(result) else result
        except GrocyError:
            raise
        except Exception as error:
            raise GrocyError(str(error), code=None) from error
    if name == _OPEN_FOOD_FACTS:
        return await lookup_open_food_facts(session, actor, barcode)
    if name == "DemoBarcodeLookupPlugin":
        if barcode == "nothing":
            return None
        if barcode == "error":
            raise GrocyError("This is the error message from the plugin...", code=None)
        settings = await _user_settings(session, actor.user_id)
        return {
            "name": "LookedUpProduct_"
            + "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(5)),
            "location_id": settings.get("product_presets_location_id")
            if not loose_equals(settings.get("product_presets_location_id", -1), -1)
            else locations[0].id,
            "qu_id_purchase": settings.get("product_presets_qu_id")
            if not loose_equals(settings.get("product_presets_qu_id", -1), -1)
            else units[0].id,
            "qu_id_stock": settings.get("product_presets_qu_id")
            if not loose_equals(settings.get("product_presets_qu_id", -1), -1)
            else units[0].id,
            "__qu_factor_purchase_to_stock": 1,
            "__barcode": barcode,
        }
    raise GrocyError(f"Plugin {name} was not found", code=None)


async def external_barcode_lookup(
    session: AsyncSession,
    actor: Actor,
    barcode: str,
    *,
    add: bool,
) -> dict[str, Any] | None:
    plugin = get_settings().stock_barcode_lookup_plugin
    if empty(plugin):
        raise GrocyError("No barcode lookup plugin defined", code=None)
    locations = list(
        (await session.execute(select(Location).where(Location.active == 1))).scalars().all()
    )
    units = list(
        (await session.execute(select(QuantityUnit).where(QuantityUnit.active == 1)))
        .scalars()
        .all()
    )
    raw = await _plugin_output(session, actor, plugin, barcode, locations, units)
    if raw is None:
        return None
    output = validate_plugin_output(
        raw, locations={row.id for row in locations}, quantity_units={row.id for row in units}
    )
    if add:
        return await create_product_from_lookup(session, output)
    return output
