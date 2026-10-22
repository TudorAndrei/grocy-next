from fastapi import APIRouter, Request, Response

from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import (
    PhpJSONResponse,
    body_array,
    empty,
    filter_bool,
    filter_int,
    int_argument,
    intval,
    is_iso_date,
    is_iso_datetime,
    is_numeric,
    php_date,
    request_body,
    require_permission,
)
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import HouseholdSvc
from grocy.core.errors import GrocyError

router = APIRouter(tags=["household"])


@router.get("/api/chores")
async def list_chores(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    parameters = query_parameters(request.scope["query_string"])
    return PhpJSONResponse(await household.current_chores(parameters))


@router.get("/api/chores/{chore_id}")
async def get_chore(chore_id: str, _actor: AuthenticatedActor, household: HouseholdSvc) -> Response:
    chore = int_argument(chore_id, "Grocy\\Services\\ChoresService::GetChoreDetails", "choreId")
    return PhpJSONResponse(await household.chore_details(chore))


@router.post("/api/chores/{chore_id}/execute")
async def execute_chore(
    chore_id: str, request: Request, actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    body = await request_body(request)
    require_permission(actor, "CHORE_TRACK_EXECUTION", caught=True)
    values = body_array(body)
    tracked_time = php_date()
    if "tracked_time" in values and (
        is_iso_datetime(values["tracked_time"]) or is_iso_date(values["tracked_time"])
    ):
        tracked_time = values["tracked_time"]
    skipped = values["skipped"] if "skipped" in values and filter_bool(values["skipped"]) else False
    done_by = (
        values["done_by"] if "done_by" in values and not empty(values["done_by"]) else actor.user_id
    )
    execution = await household.track_chore(
        actor,
        int_argument(chore_id, "Grocy\\Services\\ChoresService::TrackChore", "choreId"),
        tracked_time,
        done_by,
        skipped,
    )
    return PhpJSONResponse(await household.chore_execution(execution))


@router.post("/api/chores/executions/{execution_id}/undo", status_code=204)
async def undo_chore(
    execution_id: str, actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    require_permission(actor, "CHORE_UNDO_EXECUTION", caught=True)
    await household.undo_chore_execution(execution_id)
    return Response(status_code=204)


@router.post("/api/chores/executions/calculate-next-assignments", status_code=204)
async def calculate_next_assignments(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    values = body_array(await request_body(request, caught=True))
    chore_id = values.get("chore_id")
    selected = "chore_id" in values and not empty(chore_id) and is_numeric(chore_id)
    await household.calculate_next_execution_assignments(intval(chore_id) if selected else None)
    return Response(status_code=204)


@router.post("/api/chores/{chore_id_to_keep}/merge/{chore_id_to_remove}", status_code=204)
async def merge_chores(
    chore_id_to_keep: str,
    chore_id_to_remove: str,
    actor: AuthenticatedActor,
    household: HouseholdSvc,
) -> Response:
    require_permission(actor, "MASTER_DATA_EDIT")
    keep, remove = filter_int(chore_id_to_keep), filter_int(chore_id_to_remove)
    if keep is None or remove is None:
        raise GrocyError(
            "Provided {choreIdToKeep} or {choreIdToRemove} is not a valid integer", code=None
        )
    await household.merge_chores(keep, remove)
    return Response(status_code=204)


@router.get("/api/tasks")
async def list_tasks(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    parameters = query_parameters(request.scope["query_string"])
    return PhpJSONResponse(await household.current_tasks(parameters))


@router.post("/api/tasks/{task_id}/complete", status_code=204)
async def complete_task(
    task_id: str, request: Request, actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    require_permission(actor, "TASKS_MARK_COMPLETED")
    values = body_array(await request_body(request))
    done_time = php_date()
    if "done_time" in values and is_iso_datetime(values["done_time"]):
        done_time = values["done_time"]
    await household.mark_task_completed(task_id, done_time)
    return Response(status_code=204)


@router.post("/api/tasks/{task_id}/undo", status_code=204)
async def undo_task(task_id: str, actor: AuthenticatedActor, household: HouseholdSvc) -> Response:
    require_permission(actor, "TASKS_UNDO_EXECUTION")
    await household.undo_task(task_id)
    return Response(status_code=204)


@router.get("/api/batteries")
async def list_batteries(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    parameters = query_parameters(request.scope["query_string"])
    return PhpJSONResponse(await household.current_batteries(parameters))


@router.get("/api/batteries/{battery_id}")
async def get_battery(
    battery_id: str, _actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    battery = int_argument(
        battery_id, "Grocy\\Services\\BatteriesService::GetBatteryDetails", "batteryId"
    )
    return PhpJSONResponse(await household.battery_details(battery))


@router.post("/api/batteries/{battery_id}/charge")
async def charge_battery(
    battery_id: str, request: Request, actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    require_permission(actor, "BATTERIES_TRACK_CHARGE_CYCLE")
    values = body_array(await request_body(request))
    tracked_time = php_date()
    if "tracked_time" in values and is_iso_datetime(values["tracked_time"]):
        tracked_time = values["tracked_time"]
    cycle = await household.track_charge_cycle(
        int_argument(
            battery_id, "Grocy\\Services\\BatteriesService::TrackChargeCycle", "batteryId"
        ),
        tracked_time,
    )
    return PhpJSONResponse(await household.charge_cycle(cycle))


@router.post("/api/batteries/charge-cycles/{charge_cycle_id}/undo", status_code=204)
async def undo_battery_charge(
    charge_cycle_id: str, actor: AuthenticatedActor, household: HouseholdSvc
) -> Response:
    require_permission(actor, "BATTERIES_UNDO_CHARGE_CYCLE")
    await household.undo_charge_cycle(charge_cycle_id)
    return Response(status_code=204)
