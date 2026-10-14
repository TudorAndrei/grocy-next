from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel

from grocy.core.auth import CurrentActor
from grocy.core.deps import HouseholdSvc

router = APIRouter(tags=["household"])


class TrackingBody(BaseModel):
    tracked_time: datetime | None = None
    done_by: int | None = None
    skipped: bool = False


@router.get("/api/chores")
async def list_chores(_actor: CurrentActor, household: HouseholdSvc) -> list[dict[str, Any]]:
    return await household.list_chores()


@router.get("/api/chores/{chore_id}")
async def get_chore(
    chore_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.get_chore(chore_id)


@router.post("/api/chores/{chore_id}/execute")
async def execute_chore(
    chore_id: int,
    actor: CurrentActor,
    household: HouseholdSvc,
    body: TrackingBody | None = None,
) -> dict[str, Any]:
    return await household.execute_chore(actor, chore_id, **(body.model_dump() if body else {}))


@router.post("/api/chores/executions/{execution_id}/undo", status_code=204)
async def undo_chore(
    execution_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.undo_chore_execution(execution_id)
    return Response(status_code=204)


@router.post("/api/chores/executions/calculate-next-assignments", status_code=204)
async def calculate_next_assignments(
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.calculate_next_assignments()
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
    _actor: CurrentActor,
    household: HouseholdSvc,
    include_done: Annotated[bool, Query()] = False,
) -> list[dict[str, Any]]:
    return await household.list_tasks(include_done=include_done)


@router.post("/api/tasks/{task_id}/complete", status_code=204)
async def complete_task(
    task_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.complete_task(task_id)
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
async def list_batteries(_actor: CurrentActor, household: HouseholdSvc) -> list[dict[str, Any]]:
    return await household.list_batteries()


@router.get("/api/batteries/{battery_id}")
async def get_battery(
    battery_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.get_battery(battery_id)


@router.post("/api/batteries/{battery_id}/charge")
async def charge_battery(
    battery_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
    body: TrackingBody | None = None,
) -> dict[str, Any]:
    return await household.charge_battery(
        battery_id, tracked_time=body.tracked_time if body else None
    )


@router.post("/api/batteries/charge-cycles/{charge_cycle_id}/undo", status_code=204)
async def undo_battery_charge(
    charge_cycle_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> Response:
    await household.undo_battery_charge(charge_cycle_id)
    return Response(status_code=204)
