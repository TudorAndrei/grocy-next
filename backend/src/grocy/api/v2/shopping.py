from decimal import Decimal

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession, ShoppingSvc
from grocy.domains.shopping.paper import ShoppingPaper
from grocy.domains.system.service import SystemService

router = APIRouter(tags=["shopping"])


@router.get("/shopping-lists/{shopping_list_id}/print", response_class=HTMLResponse)
async def shopping_paper(
    shopping_list_id: int,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
    header: bool = True,
    grouped: bool = True,
    layout: str = "table",
) -> HTMLResponse:
    actor.require("SHOPPINGLIST")
    locale = await SystemService(session).locale(
        actor.user_id, request.headers.get("accept-language", "")
    )
    return HTMLResponse(
        await ShoppingPaper(session).document(
            shopping_list_id,
            actor.user_id,
            locale,
            header=header,
            grouped=grouped,
            layout=layout,
            base_url=str(request.base_url).rstrip("/"),
        )
    )


class ShoppingAddBody(BaseModel):
    product_id: int
    amount: Decimal = Field(default=Decimal("1"), gt=0)
    note: str | None = None
    shopping_list_id: int = 1
    qu_id: int | None = None


@router.get("/shopping-lists/{shopping_list_id}")
async def get_shopping_list(
    shopping_list_id: int,
    _actor: CurrentActor,
    shopping: ShoppingSvc,
) -> dict:
    return await shopping.get_list(shopping_list_id)


@router.post("/shopping-lists/items")
async def add_shopping_item(
    body: ShoppingAddBody,
    actor: CurrentActor,
    shopping: ShoppingSvc,
) -> dict:
    actor.require("SHOPPINGLIST_ITEMS_ADD")
    return await shopping.add_item(
        body.product_id,
        body.amount,
        shopping_list_id=body.shopping_list_id,
        note=body.note,
        qu_id=body.qu_id,
    )


@router.post("/shopping-lists/{shopping_list_id}/items/{item_id}/purchase")
async def purchase_shopping_item(
    shopping_list_id: int,
    item_id: int,
    actor: AuthenticatedActor,
    shopping: ShoppingSvc,
) -> dict:
    actor.require("STOCK_PURCHASE")
    actor.require("SHOPPINGLIST_ITEMS_DELETE")
    return await shopping.purchase_item(actor, shopping_list_id, item_id)
