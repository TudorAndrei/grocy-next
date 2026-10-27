"""Parse stock inputs after the legacy permission and text filter checks."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import Depends, Request

from grocy.compatibility.input import json_body
from grocy.compatibility.php import (
    argument_error,
    body_array,
    empty,
    filter_bool,
    intval,
    is_iso_date,
    is_numeric,
    php_string,
    request_body,
    truthy,
)
from grocy.core.auth import CurrentActor
from grocy.core.errors import GrocyError


@dataclass
class StockBody:
    amount: Decimal
    new_amount: Decimal
    best_before_date: date | None = None
    purchased_date: date | None = None
    price: Decimal | None = None
    location_id: int | None = None
    shopping_location_id: int | None = None
    note: Any = None
    stock_label_type: int = 0
    transaction_type: str = "purchase"
    exact_amount: bool = False
    spoiled: bool = False
    allow_subproduct_substitution: bool = False
    stock_entry_id: str | None = None
    recipe_id: int | None = None
    location_id_from: int = 0
    location_id_to: int = 0
    open: Any = None


def _decimal(value: Any, function: str, name: str, position: int = 2) -> Decimal:
    if isinstance(value, bool):
        return Decimal(int(value))
    if not is_numeric(value):
        raise argument_error(function, position, name, "float", value)
    return Decimal(str(float(value)))


def _number(values: dict[str, Any], name: str) -> int | None:
    value = values.get(name)
    return intval(value) if is_numeric(value) else None


def _date(values: dict[str, Any], name: str) -> date | None:
    value = values.get(name)
    return date.fromisoformat(php_string(value)) if name in values and is_iso_date(value) else None


async def stock_body(request: Request, _actor: CurrentActor) -> StockBody:
    values = await json_body(request)
    action = "edit" if request.method == "PUT" else request.url.path.rsplit("/", 1)[-1]
    method = {
        "add": "AddProduct",
        "consume": "ConsumeProduct",
        "open": "OpenProduct",
        "transfer": "TransferProduct",
        "inventory": "InventoryProduct",
        "edit": "EditStockEntry",
    }[action]
    function = "Grocy\\Services\\StockService::" + method
    name = "new_amount" if action == "inventory" else "amount"
    if name not in values:
        message = "An new amount is required" if action == "inventory" else "An amount is required"
        raise GrocyError(message, code=None)
    if action == "transfer":
        for key, direction in (("location_id_from", "from"), ("location_id_to", "to")):
            if key not in values:
                raise GrocyError(f"A transfer {direction} location is required", code=None)
    amount = _decimal(values[name], function, "newAmount" if action == "inventory" else "amount")
    body = StockBody(amount=amount, new_amount=amount)
    if action in {"add", "consume", "transfer"} and amount <= 0:
        raise GrocyError("Amount can't be <= 0", code=None)
    if action in {"add", "inventory", "edit"}:
        body.best_before_date = _date(values, "best_before_date")
        body.purchased_date = _date(values, "purchased_date")
        body.price = Decimal(values["price"]) if is_numeric(values.get("price")) else None
        body.location_id = _number(values, "location_id")
        body.shopping_location_id = _number(values, "shopping_location_id")
        body.stock_label_type = _number(values, "stock_label_type") or 0
        body.note = values.get("note") or None
    if action == "add":
        body.transaction_type = values.get("transaction_type") or "purchase"
    if action == "consume":
        spoiled = values.get("spoiled", False)
        if isinstance(spoiled, (dict, list)):
            raise argument_error(function, 3, "spoiled", "bool", spoiled)
        body.spoiled = truthy(spoiled)
        body.recipe_id = _number(values, "recipe_id")
        body.location_id = (
            _number(values, "location_id") if not empty(values.get("location_id")) else None
        )
        body.exact_amount = truthy(values.get("exact_amount"))
        body.transaction_type = (
            values["transactiontype"]
            if "transaction_type" in values and not empty(values.get("transactiontype"))
            else "consume"
        )
    if action in {"consume", "open", "transfer"}:
        value = values.get("stock_entry_id")
        body.stock_entry_id = php_string(value) if not empty(value) else None
        body.allow_subproduct_substitution = truthy(values.get("allow_subproduct_substitution"))
    if action == "transfer":
        for key, position, parameter in (
            ("location_id_from", 3, "locationIdFrom"),
            ("location_id_to", 4, "locationIdTo"),
        ):
            value = _decimal(values[key], function, parameter, position)
            setattr(body, key, int(value))
    if action == "edit":
        body.open = values.get("open")
    return body


StockInput = Annotated[StockBody, Depends(stock_body)]


@dataclass
class ShoppingBody:
    list_id: int = 1
    done_only: bool = False
    product_id: int = 0
    product_amount: Decimal = Decimal("1")
    note: Any = None
    qu_id: Any = -1


async def shopping_body(request: Request, _actor: CurrentActor) -> ShoppingBody:
    values = body_array(await request_body(request, caught=True))
    body = ShoppingBody()
    for name in ("list_id", "product_id", "product_amount"):
        value = values.get(name)
        if not empty(value) and is_numeric(value):
            parsed = intval(value)
            setattr(body, name, Decimal(parsed) if name == "product_amount" else parsed)
    body.done_only = filter_bool(values.get("done_only"))
    body.note = values.get("note") if not empty(values.get("note")) else None
    body.qu_id = values.get("qu_id") if not empty(values.get("qu_id")) else -1
    if request.url.path.endswith(("/add-product", "/remove-product")) and body.product_id == 0:
        raise GrocyError("No product id was supplied", code=None)
    return body


ShoppingInput = Annotated[ShoppingBody, Depends(shopping_body)]
