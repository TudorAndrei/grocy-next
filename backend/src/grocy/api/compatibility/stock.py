from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response

from grocy.api.compatibility.responses import native_action_response, native_list_response
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession, StockSvc

router = APIRouter(tags=["stock"])


@router.get("/api/stock")
async def stock_overview(
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "stock")


@router.get("/api/stock/volatile")
async def stock_volatile(
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "volatile")


@router.get("/api/stock/entry/{entry_id}")
async def stock_get_entry(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_entry", entry_id, actor.user_id)


@router.put("/api/stock/entry/{entry_id}")
async def stock_edit_entry(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_edit", entry_id, actor.user_id)


@router.get("/api/stock/entry/{entry_id}/printlabel")
async def stock_entry_printlabel(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_entry_label", entry_id, actor.user_id
    )


@router.get("/api/stock/products/{product_id}")
async def stock_product(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_product", product_id, actor.user_id
    )


@router.get("/api/stock/products/{product_id}/locations")
async def stock_product_locations(
    product_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "product_locations", product_id)


@router.get("/api/stock/products/{product_id}/entries")
async def stock_entries(
    product_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "product_entries", product_id)


@router.get("/api/stock/products/{product_id}/price-history")
async def stock_price_history(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_prices", product_id, actor.user_id)


@router.post("/api/stock/products/{product_id}/add")
async def stock_add(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_add", product_id, actor.user_id)


@router.post("/api/stock/products/{product_id}/consume")
async def stock_consume(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_consume", product_id, actor.user_id
    )


@router.post("/api/stock/products/{product_id}/open")
async def stock_open(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_open", product_id, actor.user_id)


@router.post("/api/stock/products/{product_id}/transfer")
async def stock_transfer(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_transfer", product_id, actor.user_id
    )


@router.post("/api/stock/products/{product_id}/inventory")
async def stock_inventory(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_inventory", product_id, actor.user_id
    )


@router.get("/api/stock/products/{product_id}/printlabel")
async def stock_product_printlabel(
    product_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_product_label", product_id, actor.user_id
    )


@router.post(
    "/api/stock/products/{product_id_to_keep}/merge/{product_id_to_remove}", status_code=204
)
async def stock_merge_products(
    product_id_to_keep: str,
    product_id_to_remove: str,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
) -> Response:
    return await native_action_response(
        request,
        session,
        "stock_merge",
        product_id_to_keep,
        actor.user_id,
        arguments={"remove_id": product_id_to_remove},
    )


@router.get("/api/stock/products/by-barcode/{barcode}")
async def stock_product_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_barcode", barcode, actor.user_id)


@router.post("/api/stock/products/by-barcode/{barcode}/add")
async def stock_add_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_add_barcode", barcode, actor.user_id
    )


@router.post("/api/stock/products/by-barcode/{barcode}/consume")
async def stock_consume_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_consume_barcode", barcode, actor.user_id
    )


@router.post("/api/stock/products/by-barcode/{barcode}/open")
async def stock_open_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_open_barcode", barcode, actor.user_id
    )


@router.post("/api/stock/products/by-barcode/{barcode}/transfer")
async def stock_transfer_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_transfer_barcode", barcode, actor.user_id
    )


@router.post("/api/stock/products/by-barcode/{barcode}/inventory")
async def stock_inventory_by_barcode(
    barcode: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_inventory_barcode", barcode, actor.user_id
    )


@router.get("/api/stock/locations/{location_id}/entries")
async def stock_location_entries(
    location_id: str,
    request: Request,
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "location_entries", location_id)


@router.post("/api/stock/shoppinglist/add-missing-products", status_code=204)
async def stock_shopping_add_missing(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_missing", "", actor.user_id)


@router.post("/api/stock/shoppinglist/add-overdue-products", status_code=204)
async def stock_shopping_add_overdue(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_overdue", "", actor.user_id)


@router.post("/api/stock/shoppinglist/add-expired-products", status_code=204)
async def stock_shopping_add_expired(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_expired", "", actor.user_id)


@router.post("/api/stock/shoppinglist/clear", status_code=204)
async def stock_shopping_clear(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_clear", "", actor.user_id)


@router.post("/api/stock/shoppinglist/add-product", status_code=204)
async def stock_shopping_add_product(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_add", "", actor.user_id)


@router.post("/api/stock/shoppinglist/remove-product", status_code=204)
async def stock_shopping_remove_product(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_remove", "", actor.user_id)


@router.get("/api/stock/bookings/{booking_id}")
async def stock_get_booking(
    booking_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_booking", booking_id, actor.user_id
    )


@router.post("/api/stock/bookings/{booking_id}/undo", status_code=204)
async def stock_undo(
    booking_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "stock_undo", booking_id, actor.user_id)


@router.get("/api/stock/transactions/{transaction_id}")
async def stock_get_transaction(
    transaction_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_transaction", transaction_id, actor.user_id
    )


@router.post("/api/stock/transactions/{transaction_id}/undo", status_code=204)
async def stock_undo_transaction(
    transaction_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "stock_undo_transaction", transaction_id, actor.user_id
    )


@router.get("/api/stock/barcodes/external-lookup/{barcode}")
async def stock_external_barcode_lookup(
    barcode: str,
    _actor: CurrentActor,
    stock: StockSvc,
    add: Annotated[bool, Query()] = False,
) -> dict[str, Any]:
    if add:
        _actor.require("MASTER_DATA_EDIT")
    return await stock.external_barcode_lookup(barcode, add=add)
