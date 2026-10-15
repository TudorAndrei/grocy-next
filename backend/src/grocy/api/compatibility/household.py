from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.input import CompatibilityBody, CompatibilityRoute, filtered_body
from grocy.api.compatibility.responses import native_action_response, native_list_response
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession, HouseholdSvc
from grocy.core.errors import GrocyError

router = APIRouter(tags=["household"], route_class=CompatibilityRoute)


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
async def list_chores(request: Request, _actor: CurrentActor, session: DbSession) -> Response:
    return await native_list_response(request, session, "chores")


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
    session: DbSession,
) -> Response:
    return await native_list_response(request, session, "tasks")


@router.post("/api/tasks/{task_id}/complete", status_code=204)
async def complete_task(
    task_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "task_complete", task_id, actor.user_id)


@router.post("/api/tasks/{task_id}/undo", status_code=204)
async def undo_task(
    task_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "task_undo", task_id, actor.user_id)


@router.get("/api/batteries")
async def list_batteries(request: Request, _actor: CurrentActor, session: DbSession) -> Response:
    return await native_list_response(request, session, "batteries")


@router.get("/api/batteries/{battery_id}")
async def get_battery(
    battery_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "battery_details", battery_id, actor.user_id
    )


@router.post("/api/batteries/{battery_id}/charge")
async def charge_battery(
    battery_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "battery_charge", battery_id, actor.user_id
    )


@router.post("/api/batteries/charge-cycles/{charge_cycle_id}/undo", status_code=204)
async def undo_battery_charge(
    charge_cycle_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "battery_undo", charge_cycle_id, actor.user_id
    )
