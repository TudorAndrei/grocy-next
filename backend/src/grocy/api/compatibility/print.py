from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.responses import native_action_response
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["print"])


@router.get("/api/print/shoppinglist/thermal")
async def print_shoppinglist_thermal(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "shopping_thermal", "", actor.user_id)


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
