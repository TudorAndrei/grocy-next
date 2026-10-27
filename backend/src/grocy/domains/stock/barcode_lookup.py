from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility import client_defaults
from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.db.models.catalog import Location, Product, ProductBarcode, QuantityUnit
from grocy.db.models.units import QuantityUnitConversion
from grocy.domains.users.service import UsersService

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


def _is_numeric(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float, Decimal)):
        return True
    if isinstance(value, str):
        try:
            float(value)
        except ValueError:
            return False
        return value.strip() != ""
    return False


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
    if location_id not in locations:
        raise GrocyError(
            f"Provided location_id ({location_id}) is not a valid location id", code=None
        )
    qu_purchase = output["qu_id_purchase"]
    if qu_purchase not in quantity_units:
        raise GrocyError(
            f"Provided qu_id_purchase ({qu_purchase}) is not a valid quantity unit id",
            code=None,
        )
    qu_stock = output["qu_id_stock"]
    if qu_stock not in quantity_units:
        raise GrocyError(
            f"Provided qu_id_stock ({qu_stock}) is not a valid quantity unit id",
            code=None,
        )
    factor = output["__qu_factor_purchase_to_stock"]
    empty = factor in (None, "", 0, 0.0) or (
        isinstance(factor, str) and factor.strip() in {"", "0"}
    )
    if empty or not _is_numeric(factor):
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
    extension = Path(path_part).suffix.lstrip(".") or "jpg"
    file_name = f"{barcode}.{extension}"
    root = get_settings().files_root.resolve() / "productpictures"
    root.mkdir(parents=True, exist_ok=True)
    target = root / file_name

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

    product_data = {key: value for key, value in plugin_output.items() if not key.startswith("__")}
    picture = await _download_image(
        str(plugin_output.get("__image_url") or ""),
        str(plugin_output["__barcode"]),
    )
    if picture:
        product_data["picture_file_name"] = picture

    product = Product(**product_data)
    session.add(product)
    await session.flush()

    session.add(ProductBarcode(product_id=product.id, barcode=str(plugin_output["__barcode"])))
    if plugin_output["qu_id_stock"] != plugin_output["qu_id_purchase"]:
        session.add(
            QuantityUnitConversion(
                product_id=product.id,
                from_qu_id=int(plugin_output["qu_id_purchase"]),
                to_qu_id=int(plugin_output["qu_id_stock"]),
                factor=Decimal(str(plugin_output["__qu_factor_purchase_to_stock"])),
            )
        )
    await session.commit()
    result = dict(plugin_output)
    result["id"] = str(product.id)
    return result


async def external_barcode_lookup(
    session: AsyncSession,
    actor: Actor,
    barcode: str,
    *,
    add: bool,
) -> dict[str, Any] | None:
    plugin = get_settings().stock_barcode_lookup_plugin
    if plugin == "":
        raise GrocyError("No barcode lookup plugin defined", code=None)
    if plugin != _OPEN_FOOD_FACTS:
        raise GrocyError(f"Plugin {plugin} was not found", code=None)

    raw = await lookup_open_food_facts(session, actor, barcode)
    if raw is None:
        return None

    locations = {
        row.id
        for row in (await session.execute(select(Location).where(Location.active == 1)))
        .scalars()
        .all()
    }
    units = {
        row.id
        for row in (await session.execute(select(QuantityUnit).where(QuantityUnit.active == 1)))
        .scalars()
        .all()
    }
    output = validate_plugin_output(raw, locations=locations, quantity_units=units)
    if add:
        return await create_product_from_lookup(session, output)
    return output
