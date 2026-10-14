from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from grocy.core.auth import CurrentActor
from grocy.core.deps import ShoppingSvc

router = APIRouter(tags=["shopping"])


class ShoppingAddBody(BaseModel):
    product_id: int
    amount: Decimal = Field(default=Decimal("1"), gt=0)
    note: str | None = None
    shopping_list_id: int = 1


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
    _actor: CurrentActor,
    shopping: ShoppingSvc,
) -> dict:
    return await shopping.add_item(
        body.product_id,
        body.amount,
        shopping_list_id=body.shopping_list_id,
        note=body.note,
    )
