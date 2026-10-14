import asyncio
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool

from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.domains.catalog.objects import GenericObjectsService
from grocy.domains.shopping.service import ShoppingService

router = APIRouter(tags=["print"])


async def label(session: DbSession, entity: str, object_id: int) -> dict[str, Any]:
    details = await GenericObjectsService(session).get_entity(entity, object_id)
    kind, code = {
        "products": ("product", "p"),
        "chores": ("chore", "c"),
        "batteries": ("battery", "b"),
        "recipes": ("recipe", "r"),
        "stock": ("product", "p"),
    }[entity]
    product_id = details.get("product_id", object_id) if entity == "stock" else object_id
    name = details.get("name", "")
    if entity == "stock":
        product = await GenericObjectsService(session).get_entity("products", product_id)
        name = product["name"]
    grocycode = f"grcy:{code}:{product_id}"
    if entity == "stock":
        grocycode += f":{details['stock_id']}"
    payload = {kind: name, "grocycode": grocycode, "details": details}
    webhook = get_settings().label_printer_webhook
    if webhook:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(webhook, json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise GrocyError("Label printer request failed", status_code=502) from exc
    return payload


@router.get("/api/print/shoppinglist/thermal")
async def print_shoppinglist_thermal(
    actor: CurrentActor,
    session: DbSession,
    list_id: Annotated[int, Query(alias="list", gt=0)] = 1,
    print_header: Annotated[bool, Query(alias="printHeader")] = True,
) -> dict:
    actor.require("SHOPPINGLIST")
    data = await ShoppingService(session).get_list(list_id)
    lines = [data["name"]] if print_header else []
    objects = GenericObjectsService(session)
    for item in data["items"]:
        if item["done"]:
            continue
        product = (
            await objects.get_entity("products", item["product_id"]) if item["product_id"] else None
        )
        name = product["name"] if product else item["note"] or "Item"
        lines.append(f"{item['amount']:g} {name}")
    text = "\n".join(lines) + "\n"
    settings = get_settings()
    if settings.thermal_printer_host:
        try:
            async with asyncio.timeout(10):
                _reader, writer = await asyncio.open_connection(
                    settings.thermal_printer_host, settings.thermal_printer_port
                )
                try:
                    writer.write(b"\x1b@" + text.encode() + b"\n\n\n\x1dV\x00")
                    await writer.drain()
                finally:
                    writer.close()
                    await writer.wait_closed()
        except (OSError, TimeoutError) as exc:
            raise GrocyError("Thermal printer connection failed", status_code=502) from exc
        return {"result": "OK"}
    if settings.thermal_printer_device:
        try:

            def print_device() -> None:
                with Path(settings.thermal_printer_device).open("wb") as device:
                    device.write(b"\x1b@" + text.encode() + b"\n\n\n\x1dV\x00")

            await run_in_threadpool(print_device)
        except OSError as exc:
            raise GrocyError("Thermal printer device failed", status_code=502) from exc
        return {"result": "OK"}
    return {"result": "READY", "text": text}


@router.get("/api/chores/{chore_id}/printlabel")
async def print_chore_label(chore_id: int, _actor: CurrentActor, session: DbSession) -> dict:
    return await label(session, "chores", chore_id)


@router.get("/api/batteries/{battery_id}/printlabel")
async def print_battery_label(battery_id: int, _actor: CurrentActor, session: DbSession) -> dict:
    return await label(session, "batteries", battery_id)


@router.get("/api/recipes/{recipe_id}/printlabel")
async def print_recipe_label(recipe_id: int, _actor: CurrentActor, session: DbSession) -> dict:
    return await label(session, "recipes", recipe_id)
