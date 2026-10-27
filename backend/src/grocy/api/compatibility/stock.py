from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.api.compatibility.stock_input import ShoppingInput, StockInput
from grocy.compatibility.lessql import query_parameters, query_rows
from grocy.compatibility.php import PhpJSONResponse, argument_error, filter_bool, int_argument
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession, ShoppingSvc, StockSvc
from grocy.core.errors import GrocyError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.db.native_schema import SCHEMA
from grocy.domains.printing import product_label, stock_entry, stock_label
from grocy.domains.stock.service import StockService

router = APIRouter(tags=["stock"])


@router.get("/api/stock")
async def stock_overview(_actor: CurrentActor, stock: StockSvc) -> list[dict[str, Any]]:
    return await stock.current_stock()


@router.get("/api/stock/volatile")
async def stock_volatile(
    _actor: CurrentActor,
    stock: StockSvc,
    due_soon_days: Annotated[int, Query(alias="due_soon_days")] = 5,
) -> dict[str, Any]:
    return await stock.volatile(due_soon_days=due_soon_days)


@router.get("/api/stock/entry/{entry_id}")
async def stock_get_entry(entry_id: str, _actor: CurrentActor, session: DbSession) -> Response:
    rows = await query_rows(
        session,
        "stock",
        {},
        where="id = ?",
        bindings=(entry_id,),
        columns=SCHEMA["tables"]["stock"],
    )
    return PhpJSONResponse(rows[0] if rows else None)


@router.put("/api/stock/entry/{entry_id}")
async def stock_edit_entry(
    entry_id: int,
    body: StockInput,
    actor: CurrentActor,
    stock: StockSvc,
) -> list[dict[str, Any]]:
    fields: dict[str, Any] = {
        "amount": body.amount,
        "best_before_date": body.best_before_date,
        "purchased_date": body.purchased_date,
        "location_id": body.location_id,
        "shopping_location_id": body.shopping_location_id,
        "note": body.note,
    }
    if body.price is not None:
        fields["price"] = Decimal(str(body.price))
    if body.open is not None:
        fields["open"] = body.open
    return await stock.edit_entry(entry_id, actor=actor, **fields)


async def _label_details(stock: StockService, product_id: int) -> dict[str, Any]:
    try:
        return await stock.product_details(product_id, compatibility=True)
    except GrocyError as error:
        if error.details is not None:
            raise
        raise GrocyError(error.message, code=None) from error


@router.get("/api/stock/entry/{entry_id}/printlabel")
async def stock_entry_printlabel(
    entry_id: str, _actor: CurrentActor, session: DbSession, stock: StockSvc
) -> Response:
    entry = await stock_entry(session, entry_id)
    if entry is None:
        raise argument_error(
            "Grocy\\Services\\StockService::GetProductDetails", 1, "productId", "int", None
        )
    details = await _label_details(stock, entry["product_id"])
    label = await stock_label(entry["product_id"], details, entry, entry["best_before_date"])
    return PhpJSONResponse(label)


@router.get("/api/stock/products/{product_id}")
async def stock_product(product_id: int, _actor: CurrentActor, stock: StockSvc) -> dict[str, Any]:
    return await stock.product_details(product_id, compatibility=True)


@router.get("/api/stock/products/{product_id}/locations")
async def stock_product_locations(
    product_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return await _product_stock_rows(
        product_id, request, session, "stock_current_locations", "GetProductStockLocations"
    )


@router.get("/api/stock/products/{product_id}/entries")
async def stock_entries(
    product_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return await _product_stock_rows(
        product_id, request, session, "stock_next_use", "GetProductStockEntries"
    )


async def _product_stock_rows(
    product_id: str, request: Request, session: AsyncSession, table: str, method: str
) -> Response:
    identity = int_argument(product_id, "Grocy\\Services\\StockService::" + method, "productId")
    parameters = query_parameters(request.scope["query_string"])
    where = "product_id = ?"
    bindings = (identity,)
    if filter_bool(parameters.get("include_sub_products")):
        where = (
            "product_id = ? OR product_id IN "
            "(SELECT sub_product_id FROM products_resolved WHERE parent_product_id = ?)"
        )
        bindings = (identity, identity)
    if table == "stock_next_use":
        where = f"({where}) AND open IN (0, 1)"
    await configure_compatibility_queries(session)
    return PhpJSONResponse(
        await query_rows(session, table, parameters, where=where, bindings=bindings)
    )


@router.get("/api/stock/products/{product_id}/price-history")
async def stock_price_history(product_id: int, _actor: CurrentActor, stock: StockSvc) -> list[dict]:
    return await stock.price_history(product_id)


@router.post("/api/stock/products/{product_id}/add")
async def stock_add(
    product_id: int, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.purchase(
        actor,
        product_id,
        body.amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        price=Decimal(str(body.price)) if body.price is not None else None,
        location_id=body.location_id,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        transaction_type=body.transaction_type,
        exact_amount=body.exact_amount,
        stock_label_type=body.stock_label_type,
    )


@router.post("/api/stock/products/{product_id}/consume")
async def stock_consume(
    product_id: int, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.consume(
        actor,
        product_id,
        body.amount,
        spoiled=body.spoiled,
        transaction_type=body.transaction_type,
        location_id=body.location_id,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
        stock_entry_id=body.stock_entry_id,
        recipe_id=body.recipe_id,
        exact_amount=body.exact_amount,
    )


@router.post("/api/stock/products/{product_id}/open")
async def stock_open(
    product_id: int, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.open(
        actor,
        product_id,
        body.amount,
        stock_entry_id=body.stock_entry_id,
        allow_subproduct_substitution=body.allow_subproduct_substitution,
    )


@router.post("/api/stock/products/{product_id}/transfer")
async def stock_transfer(
    product_id: int, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.transfer(
        actor,
        product_id,
        body.amount,
        body.location_id_from,
        body.location_id_to,
        stock_entry_id=body.stock_entry_id,
    )


@router.post("/api/stock/products/{product_id}/inventory")
async def stock_inventory(
    product_id: int, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.inventory(
        actor,
        product_id,
        body.new_amount,
        best_before_date=body.best_before_date,
        purchased_date=body.purchased_date,
        location_id=body.location_id,
        price=Decimal(str(body.price)) if body.price is not None else None,
        shopping_location_id=body.shopping_location_id,
        note=body.note,
        stock_label_type=body.stock_label_type,
    )


@router.get("/api/stock/products/{product_id}/printlabel")
async def stock_product_printlabel(
    product_id: str, _actor: CurrentActor, stock: StockSvc
) -> Response:
    product = int_argument(
        product_id, "Grocy\\Services\\StockService::GetProductDetails", "productId"
    )
    return PhpJSONResponse(await product_label(await _label_details(stock, product)))


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
async def stock_product_by_barcode(barcode: str, _actor: CurrentActor, stock: StockSvc) -> dict:
    details = await stock.product_by_barcode(barcode)
    product = details.get("product") or details
    product_id = product.get("id") if isinstance(product, dict) else details.get("id")
    return {"product_id": product_id, "product": product}


@router.post("/api/stock/products/by-barcode/{barcode}/add")
async def stock_add_by_barcode(
    barcode: str, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.purchase_by_barcode(
        actor,
        barcode,
        body.amount,
        best_before_date=body.best_before_date,
        location_id=body.location_id,
    )


@router.post("/api/stock/products/by-barcode/{barcode}/consume")
async def stock_consume_by_barcode(
    barcode: str, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.consume_by_barcode(actor, barcode, body.amount, spoiled=body.spoiled)


@router.post("/api/stock/products/by-barcode/{barcode}/open")
async def stock_open_by_barcode(
    barcode: str, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.open_by_barcode(actor, barcode, body.amount)


@router.post("/api/stock/products/by-barcode/{barcode}/transfer")
async def stock_transfer_by_barcode(
    barcode: str, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.transfer_by_barcode(
        actor,
        barcode,
        body.amount,
        body.location_id_from,
        body.location_id_to,
    )


@router.post("/api/stock/products/by-barcode/{barcode}/inventory")
async def stock_inventory_by_barcode(
    barcode: str, body: StockInput, actor: CurrentActor, stock: StockSvc
) -> list[dict[str, Any]]:
    return await stock.inventory_by_barcode(actor, barcode, body.new_amount)


@router.get("/api/stock/locations/{location_id}/entries")
async def stock_location_entries(
    location_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    exists = await session.scalar(
        text("SELECT 1 FROM locations WHERE id=:location AND active=1"), {"location": location_id}
    )
    if not exists:
        raise GrocyError("Location does not exist", status_code=500, code=None)
    return PhpJSONResponse(
        await query_rows(
            session,
            "stock",
            query_parameters(request.scope["query_string"]),
            where="location_id = ?",
            bindings=(location_id,),
            columns=SCHEMA["tables"]["stock"],
        )
    )


@router.post("/api/stock/shoppinglist/add-missing-products", status_code=204)
async def stock_shopping_add_missing(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.add_missing_products(shopping_list_id=body.list_id)
    return Response(status_code=204)


@router.post("/api/stock/shoppinglist/add-overdue-products", status_code=204)
async def stock_shopping_add_overdue(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.add_overdue_products(shopping_list_id=body.list_id)
    return Response(status_code=204)


@router.post("/api/stock/shoppinglist/add-expired-products", status_code=204)
async def stock_shopping_add_expired(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.add_expired_products(shopping_list_id=body.list_id)
    return Response(status_code=204)


@router.post("/api/stock/shoppinglist/clear", status_code=204)
async def stock_shopping_clear(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.clear_list(shopping_list_id=body.list_id, done_only=body.done_only)
    return Response(status_code=204)


@router.post("/api/stock/shoppinglist/add-product", status_code=204)
async def stock_shopping_add_product(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.add_product(
        body.product_id,
        body.product_amount,
        shopping_list_id=body.list_id,
        note=body.note,
        qu_id=body.qu_id,
    )
    return Response(status_code=204)


@router.post("/api/stock/shoppinglist/remove-product", status_code=204)
async def stock_shopping_remove_product(body: ShoppingInput, shopping: ShoppingSvc) -> Response:
    await shopping.remove_product(
        body.product_id, body.product_amount, shopping_list_id=body.list_id
    )
    return Response(status_code=204)


@router.get("/api/stock/bookings/{booking_id}")
async def stock_get_booking(booking_id: int, _actor: CurrentActor, stock: StockSvc) -> dict:
    return await stock.get_booking(booking_id)


@router.post("/api/stock/bookings/{booking_id}/undo", status_code=204)
async def stock_undo(booking_id: int, actor: CurrentActor, stock: StockSvc) -> Response:
    await stock.undo_booking(actor, booking_id)
    return Response(status_code=204)


@router.get("/api/stock/transactions/{transaction_id}")
async def stock_get_transaction(
    transaction_id: str, _actor: CurrentActor, stock: StockSvc
) -> list[dict]:
    return await stock.get_transaction(transaction_id)


@router.post("/api/stock/transactions/{transaction_id}/undo", status_code=204)
async def stock_undo_transaction(
    transaction_id: str, actor: CurrentActor, stock: StockSvc
) -> Response:
    await stock.undo_transaction(actor, transaction_id)
    return Response(status_code=204)


@router.get("/api/stock/barcodes/external-lookup/{barcode}")
async def stock_external_barcode_lookup(
    barcode: str,
    actor: CurrentActor,
    stock: StockSvc,
    add: Annotated[str | None, Query()] = None,
) -> dict[str, Any] | None:
    return await stock.external_barcode_lookup(actor, barcode, add=add == "true")
