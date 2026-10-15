from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field

from grocy.api.compatibility.input import CompatibilityBody, CompatibilityRoute, filtered_body
from grocy.api.compatibility.responses import native_action_response, native_list_response
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession, StockSvc
from grocy.domains.printing import label

router = APIRouter(tags=["stock"], route_class=CompatibilityRoute)


async def _bookings(stock: StockSvc, result: dict) -> list[dict]:
    transaction_id = result.get("transaction_id")
    return await stock.get_transaction(transaction_id) if transaction_id else []


class AmountBody(CompatibilityBody):
    amount: Decimal = Field(gt=0)
    best_before_date: date | None = None
    purchased_date: date | None = None
    price: Decimal | None = None
    location_id: int | None = None
    spoiled: bool = False
    transaction_type: str | None = None
    shopping_location_id: int | None = None
    stock_entry_id: str | None = None
    recipe_id: int | None = None
    exact_amount: bool = False
    allow_subproduct_substitution: bool = False
    note: str | None = None
    stock_label_type: int = Field(default=0, ge=0, le=2)


class TransferBody(CompatibilityBody):
    amount: Decimal = Field(gt=0)
    location_id_from: int
    location_id_to: int
    stock_entry_id: str | None = None


class InventoryBody(CompatibilityBody):
    purchased_date: date | None = None
    price: Decimal | None = None
    shopping_location_id: int | None = None
    note: str | None = None
    stock_label_type: int = Field(default=0, ge=0, le=2)
    new_amount: Decimal = Field(ge=0)
    best_before_date: date | None = None
    location_id: int | None = None


class EditEntryBody(CompatibilityBody):
    amount: Decimal | None = None
    best_before_date: date | None = None
    purchased_date: date | None = None
    price: Decimal | None = None
    open: bool | None = None
    location_id: int | None = None
    shopping_location_id: int | None = None
    note: str | None = None


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
    entry_id: int,
    _actor: CurrentActor,
    stock: StockSvc,
) -> dict[str, Any] | None:
    return await stock.get_entry(entry_id)


@router.put("/api/stock/entry/{entry_id}")
@filtered_body()
async def stock_edit_entry(
    entry_id: int,
    body: EditEntryBody,
    _actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    fields = body.model_dump(exclude_unset=True)
    return await stock.edit_entry(entry_id, actor=_actor, **fields)


@router.get("/api/stock/entry/{entry_id}/printlabel")
async def stock_entry_printlabel(
    entry_id: int, _actor: CurrentActor, session: DbSession
) -> dict[str, Any]:
    return await label(session, "stock", entry_id)


@router.get("/api/stock/products/{product_id}")
async def stock_product(
    product_id: int,
    _actor: CurrentActor,
    stock: StockSvc,
) -> dict[str, Any]:
    return await stock.product_details(product_id)


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
    product_id: int,
    _actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    return await stock.price_history(product_id)


@router.post("/api/stock/products/{product_id}/add")
@filtered_body()
async def stock_add(
    product_id: int,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.purchase(
        actor,
        product_id,
        body.amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        price=body.price,
        location_id=body.location_id,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        transaction_type=body.transaction_type or "purchase",
        stock_label_type=body.stock_label_type,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/{product_id}/consume")
@filtered_body()
async def stock_consume(
    product_id: int,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.consume(
        actor,
        product_id,
        body.amount,
        spoiled=body.spoiled,
        location_id=body.location_id,
        stock_entry_id=body.stock_entry_id,
        recipe_id=body.recipe_id,
        exact_amount=body.exact_amount,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
        transaction_type=body.transaction_type or "consume",
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/{product_id}/open")
@filtered_body()
async def stock_open(
    product_id: int,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.open(
        actor,
        product_id,
        body.amount,
        stock_entry_id=body.stock_entry_id,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/{product_id}/transfer")
@filtered_body()
async def stock_transfer(
    product_id: int,
    body: TransferBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.transfer(
        actor,
        product_id,
        body.amount,
        body.location_id_from,
        body.location_id_to,
        stock_entry_id=body.stock_entry_id,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/{product_id}/inventory")
@filtered_body()
async def stock_inventory(
    product_id: int,
    body: InventoryBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.inventory(
        actor,
        product_id,
        body.new_amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        location_id=body.location_id,
        price=body.price,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        stock_label_type=body.stock_label_type,
    )
    return await _bookings(stock, result)


@router.get("/api/stock/products/{product_id}/printlabel")
async def stock_product_printlabel(
    product_id: int, _actor: CurrentActor, session: DbSession
) -> dict[str, Any]:
    return await label(session, "products", product_id)


@router.post(
    "/api/stock/products/{product_id_to_keep}/merge/{product_id_to_remove}", status_code=204
)
async def stock_merge_products(
    product_id_to_keep: int,
    product_id_to_remove: int,
    actor: CurrentActor,
    stock: StockSvc,
) -> Response:
    await stock.merge_products(actor, product_id_to_keep, product_id_to_remove)
    return Response(status_code=204)


@router.get("/api/stock/products/by-barcode/{barcode}")
async def stock_product_by_barcode(
    barcode: str,
    _actor: CurrentActor,
    stock: StockSvc,
) -> dict[str, Any]:
    return await stock.product_by_barcode(barcode)


@router.post("/api/stock/products/by-barcode/{barcode}/add")
@filtered_body()
async def stock_add_by_barcode(
    barcode: str,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.purchase_by_barcode(
        actor,
        barcode,
        body.amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        price=body.price,
        location_id=body.location_id,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        transaction_type=body.transaction_type or "purchase",
        stock_label_type=body.stock_label_type,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/by-barcode/{barcode}/consume")
@filtered_body()
async def stock_consume_by_barcode(
    barcode: str,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.consume_by_barcode(
        actor,
        barcode,
        body.amount,
        spoiled=body.spoiled,
        location_id=body.location_id,
        stock_entry_id=body.stock_entry_id,
        recipe_id=body.recipe_id,
        exact_amount=body.exact_amount,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
        transaction_type=body.transaction_type or "consume",
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/by-barcode/{barcode}/open")
@filtered_body()
async def stock_open_by_barcode(
    barcode: str,
    body: AmountBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.open_by_barcode(
        actor,
        barcode,
        body.amount,
        stock_entry_id=body.stock_entry_id,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/by-barcode/{barcode}/transfer")
@filtered_body()
async def stock_transfer_by_barcode(
    barcode: str,
    body: TransferBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.transfer_by_barcode(
        actor,
        barcode,
        body.amount,
        body.location_id_from,
        body.location_id_to,
        stock_entry_id=body.stock_entry_id,
    )
    return await _bookings(stock, result)


@router.post("/api/stock/products/by-barcode/{barcode}/inventory")
@filtered_body()
async def stock_inventory_by_barcode(
    barcode: str,
    body: InventoryBody,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    result = await stock.inventory_by_barcode(
        actor,
        barcode,
        body.new_amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        location_id=body.location_id,
        price=body.price,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        stock_label_type=body.stock_label_type,
    )
    return await _bookings(stock, result)


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
    booking_id: int,
    _actor: CurrentActor,
    stock: StockSvc,
) -> dict[str, Any]:
    return await stock.get_booking(booking_id)


@router.post("/api/stock/bookings/{booking_id}/undo", status_code=204)
async def stock_undo(
    booking_id: int,
    actor: CurrentActor,
    stock: StockSvc,
) -> Response:
    await stock.undo_booking(actor, booking_id)
    return Response(status_code=204)


@router.get("/api/stock/transactions/{transaction_id}")
async def stock_get_transaction(
    transaction_id: str,
    _actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    return await stock.get_transaction(transaction_id)


@router.post("/api/stock/transactions/{transaction_id}/undo", status_code=204)
async def stock_undo_transaction(
    transaction_id: str,
    actor: CurrentActor,
    stock: StockSvc,
) -> Response:
    await stock.undo_transaction(actor, transaction_id)
    return Response(status_code=204)


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
