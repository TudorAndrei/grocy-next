"""Code image reads for the web application."""

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.grocycode import code_response, paper_response, stock_entry_code
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["codes"])


@router.get("/products/{product_id}/grocycode")
async def product_code(product_id: str, request: Request, actor: AuthenticatedActor) -> Response:
    actor.require("STOCK")
    return await code_response(request, f"grcy:p:{product_id}")


@router.get("/chores/{chore_id}/grocycode")
async def chore_code(chore_id: str, request: Request, actor: AuthenticatedActor) -> Response:
    actor.require("CHORES")
    return await code_response(request, f"grcy:c:{chore_id}")


@router.get("/batteries/{battery_id}/grocycode")
async def battery_code(battery_id: str, request: Request, actor: AuthenticatedActor) -> Response:
    actor.require("BATTERIES")
    return await code_response(request, f"grcy:b:{battery_id}")


@router.get("/stock/entries/{entry_id}/grocycode")
async def entry_code(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    actor.require("STOCK")
    return await code_response(request, await stock_entry_code(session, entry_id))


@router.get("/stock/entries/{entry_id}/label")
async def entry_paper_label(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    actor.require("STOCK")
    return await paper_response(request, session, entry_id, actor.user_id)
