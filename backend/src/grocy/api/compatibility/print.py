from typing import Any

from fastapi import APIRouter

from grocy.core.auth import CurrentActor

router = APIRouter(tags=["print"])


def _print_stub() -> dict[str, Any]:
    return {"success": False, "error_message": "label printing not configured"}


@router.get("/api/print/shoppinglist/thermal")
async def print_shoppinglist_thermal(_actor: CurrentActor) -> dict[str, Any]:
    return _print_stub()


@router.get("/api/chores/{chore_id}/printlabel")
async def print_chore_label(chore_id: int, _actor: CurrentActor) -> dict[str, Any]:
    return {**_print_stub(), "chore_id": chore_id}


@router.get("/api/batteries/{battery_id}/printlabel")
async def print_battery_label(battery_id: int, _actor: CurrentActor) -> dict[str, Any]:
    return {**_print_stub(), "battery_id": battery_id}


@router.get("/api/recipes/{recipe_id}/printlabel")
async def print_recipe_label(recipe_id: int, _actor: CurrentActor) -> dict[str, Any]:
    return {**_print_stub(), "recipe_id": recipe_id}
