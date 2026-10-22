from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.input import database_error
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import PhpJSONResponse, int_argument, require_permission
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession, HouseholdSvc
from grocy.core.errors import GrocyError
from grocy.domains.printing import battery_label, chore_label, print_shopping_list, recipe_label

router = APIRouter(tags=["print"])


@router.get("/api/print/shoppinglist/thermal")
async def print_shoppinglist_thermal(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    require_permission(actor, "SHOPPINGLIST", caught=True)
    parameters = query_parameters(request.scope["query_string"])
    print_header = parameters.get("printHeader", "true") == "true"
    try:
        result = await print_shopping_list(session, parameters.get("list", 1), print_header)
    except DBAPIError as error:
        raise GrocyError(database_error(error).message, code=None) from error
    return PhpJSONResponse(result)


@router.get("/api/chores/{chore_id}/printlabel")
async def print_chore_label(
    chore_id: str, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    chore = int_argument(chore_id, "Grocy\\Services\\ChoresService::GetChoreDetails", "choreId")
    return PhpJSONResponse(await chore_label(chore_id, await household.chore_details(chore)))


@router.get("/api/batteries/{battery_id}/printlabel")
async def print_battery_label(
    battery_id: str, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    battery = int_argument(
        battery_id, "Grocy\\Services\\BatteriesService::GetBatteryDetails", "batteryId"
    )
    return PhpJSONResponse(
        await battery_label(battery_id, await household.battery_details(battery))
    )


@router.get("/api/recipes/{recipe_id}/printlabel")
async def print_recipe_label(
    recipe_id: str, _actor: AuthenticatedActor, session: DbSession
) -> Response:
    return PhpJSONResponse(await recipe_label(session, recipe_id))
