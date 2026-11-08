from decimal import Decimal

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession, ShoppingSvc
from grocy.core.errors import NotFoundError
from grocy.db.models.shopping import ShoppingList
from grocy.domains.shopping.notes import notes_editor
from grocy.domains.shopping.paper import ShoppingPaper
from grocy.domains.system.service import SystemService

router = APIRouter(tags=["shopping"])


class ShoppingNotesDraft(BaseModel):
    html: str
    visible: bool


@router.get("/shopping-lists")
async def shopping_lists(_actor: AuthenticatedActor, shopping: ShoppingSvc) -> list[dict]:
    return await shopping.lists()


@router.get("/shopping-lists/native-context")
async def native_shopping_context(
    request: Request, actor: AuthenticatedActor, shopping: ShoppingSvc, session: DbSession
) -> dict:
    locale = await SystemService(session).locale(
        actor.user_id, ",".join(request.headers.getlist("accept-language"))
    )
    return await shopping.native_context(request.scope.get("query_string", b""), locale)


async def _native_shopping_paper(
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
    *,
    header: bool,
    grouped: bool,
    layout: str,
    notes: tuple[str, bool] | None = None,
) -> HTMLResponse:
    locale = await SystemService(session).locale(
        actor.user_id, ",".join(request.headers.getlist("accept-language"))
    )
    return HTMLResponse(
        await ShoppingPaper(session).document(
            1,
            actor.user_id,
            locale,
            header=header,
            grouped=grouped,
            layout=layout,
            base_url=str(request.base_url).rstrip("/"),
            notes=notes,
            native_query=request.scope.get("query_string", b""),
        )
    )


@router.get("/shopping-lists/native-print", response_class=HTMLResponse)
async def native_shopping_paper(
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
    header: bool = True,
    grouped: bool = True,
    layout: str = "table",
) -> HTMLResponse:
    return await _native_shopping_paper(
        request, actor, session, header=header, grouped=grouped, layout=layout
    )


@router.post("/shopping-lists/native-print", response_class=HTMLResponse)
async def native_shopping_paper_draft(
    body: ShoppingNotesDraft,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
    header: bool = True,
    grouped: bool = True,
    layout: str = "table",
) -> HTMLResponse:
    return await _native_shopping_paper(
        request,
        actor,
        session,
        header=header,
        grouped=grouped,
        layout=layout,
        notes=(body.html, body.visible),
    )


@router.get("/shopping-lists/editor")
async def shopping_list_editor(
    _actor: AuthenticatedActor, shopping: ShoppingSvc, list_id: int | None = None
) -> dict:
    return await shopping.editor(list_id)


@router.get("/shopping-lists/items/editor")
async def shopping_item_editor(
    _actor: AuthenticatedActor, shopping: ShoppingSvc, item_id: int | None = None
) -> dict:
    return await shopping.item_editor(item_id)


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


@router.post("/shopping-lists/{shopping_list_id}/print", response_class=HTMLResponse)
async def shopping_paper_draft(
    shopping_list_id: int,
    body: ShoppingNotesDraft,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
    header: bool = True,
    grouped: bool = True,
    layout: str = "table",
) -> HTMLResponse:
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
            notes=(body.html, body.visible),
        )
    )


@router.get("/shopping-lists/{shopping_list_id}/notes/editor", response_class=HTMLResponse)
async def shopping_notes_editor(
    shopping_list_id: int,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
) -> HTMLResponse:
    shopping = await session.get(ShoppingList, shopping_list_id)
    if shopping is None:
        raise NotFoundError("Shopping list not found")
    locale = await SystemService(session).locale(
        actor.user_id, request.headers.get("accept-language", "")
    )
    document = await run_in_threadpool(notes_editor, shopping.description or "", locale)
    return HTMLResponse(document)


class ShoppingAddBody(BaseModel):
    product_id: int
    amount: Decimal = Field(default=Decimal("1"), gt=0)
    note: str | None = None
    shopping_list_id: int = 1
    qu_id: int | None = None


@router.get("/shopping-lists/{shopping_list_id}")
async def get_shopping_list(
    shopping_list_id: int,
    _actor: AuthenticatedActor,
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
