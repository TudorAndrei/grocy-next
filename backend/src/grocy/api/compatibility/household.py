from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response

from grocy.api.compatibility.filtering import filter_rows
from grocy.api.compatibility.input import CompatibilityBody, CompatibilityRoute, filtered_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import HouseholdSvc
from grocy.core.errors import GrocyError

router = APIRouter(tags=["household"], route_class=CompatibilityRoute)


class TaskCompletionBody(CompatibilityBody):
    done_time: Any = None


class TrackingBody(CompatibilityBody):
    tracked_time: Any = None
    done_by: int | None = None
    skipped: bool = False


def _timestamp(value: Any) -> datetime | None:
    if isinstance(value, (dict, list)):
        raise GrocyError("A timestamp must be a scalar value", status_code=500)
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return (
        parsed
        if parsed.tzinfo is None and parsed.isoformat(sep=" ", timespec="seconds") == value
        else None
    )


def _chore_time(value: Any) -> date | datetime | None:
    parsed = _timestamp(value)
    if parsed is not None or not isinstance(value, str):
        return parsed
    try:
        parsed_date = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed_date if parsed_date.isoformat() == value else None


@router.get("/api/chores")
async def list_chores(
    request: Request, _actor: CurrentActor, household: HouseholdSvc
) -> list[dict[str, Any]]:
    return filter_rows(await household.list_chores(), request.query_params)


@router.get("/api/chores/{chore_id}")
async def get_chore(
    chore_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.get_chore(chore_id)


@router.post("/api/chores/{chore_id}/execute")
@filtered_body(null_status=500, permission_before_filter=False)
async def execute_chore(
    chore_id: int,
    actor: CurrentActor,
    household: HouseholdSvc,
    body: TrackingBody | None = None,
) -> dict[str, Any]:
    values = body.model_dump() if body else {}
    values["tracked_time"] = _chore_time(values.get("tracked_time"))
    return await household.execute_chore(actor, chore_id, **values)


@router.post("/api/chores/executions/{execution_id}/undo", status_code=204)
async def undo_chore(
    execution_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.undo_chore_execution(execution_id)
    return Response(status_code=204)


@router.post("/api/chores/executions/calculate-next-assignments", status_code=204)
@filtered_body(null_status=500)
async def calculate_next_assignments(
    _actor: CurrentActor,
    household: HouseholdSvc,
    body: dict[str, int] | None = None,
) -> Response:
    await household.calculate_next_assignments((body or {}).get("chore_id"))
    return Response(status_code=204)


@router.post("/api/chores/{chore_id_to_keep}/merge/{chore_id_to_remove}", status_code=204)
async def merge_chores(
    chore_id_to_keep: int,
    chore_id_to_remove: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.merge_chores(chore_id_to_keep, chore_id_to_remove)
    return Response(status_code=204)


@router.get("/api/tasks")
async def list_tasks(
    request: Request,
    _actor: CurrentActor,
    household: HouseholdSvc,
    include_done: Annotated[bool, Query()] = False,
) -> list[dict[str, Any]]:
    return filter_rows(await household.list_tasks(include_done=include_done), request.query_params)


@router.post("/api/tasks/{task_id}/complete", status_code=204)
@filtered_body(null_status=500)
async def complete_task(
    task_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
    body: TaskCompletionBody | None = None,
) -> Response:
    await household.complete_task(task_id, done_time=_timestamp(body.done_time) if body else None)
    return Response(status_code=204)


@router.post("/api/tasks/{task_id}/undo", status_code=204)
async def undo_task(
    task_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.undo_task(task_id)
    return Response(status_code=204)


@router.get("/api/batteries")
async def list_batteries(
    request: Request, _actor: CurrentActor, household: HouseholdSvc
) -> list[dict[str, Any]]:
    return filter_rows(await household.list_batteries(), request.query_params)


@router.get("/api/batteries/{battery_id}")
async def get_battery(
    battery_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.get_battery(battery_id)


@router.post("/api/batteries/{battery_id}/charge")
@filtered_body(null_status=500)
async def charge_battery(
    battery_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
    body: TrackingBody | None = None,
) -> dict[str, Any]:
    return await household.charge_battery(
        battery_id, tracked_time=_timestamp(body.tracked_time) if body else None
    )


@router.post("/api/batteries/charge-cycles/{charge_cycle_id}/undo", status_code=204)
async def undo_battery_charge(
    charge_cycle_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.undo_battery_charge(charge_cycle_id)
    return Response(status_code=204)
