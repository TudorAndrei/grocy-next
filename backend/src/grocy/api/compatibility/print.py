import asyncio
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from grocy.api.compatibility.responses import native_action_response
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.domains.catalog.objects import GenericObjectsService
from grocy.domains.shopping.service import ShoppingService

router = APIRouter(tags=["print"])


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
async def print_chore_label(
    chore_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "chore_label", chore_id, actor.user_id)


@router.get("/api/batteries/{battery_id}/printlabel")
async def print_battery_label(
    battery_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "battery_label", battery_id, actor.user_id
    )


@router.get("/api/recipes/{recipe_id}/printlabel")
async def print_recipe_label(
    recipe_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "recipe_label", recipe_id, actor.user_id)
