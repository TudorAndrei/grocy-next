from typing import Annotated, Any

from fastapi import APIRouter, Query

from grocy.core.auth import CurrentActor
from grocy.core.deps import HouseholdSvc

router = APIRouter(tags=["household"])


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
) -> dict[str, Any]:
    return await household.execute_chore(actor, chore_id)


@router.post("/api/chores/executions/{execution_id}/undo")
async def undo_chore(
    execution_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.undo_chore_execution(execution_id)


@router.post("/api/chores/executions/calculate-next-assignments")
async def calculate_next_assignments(
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.calculate_next_assignments()


@router.post("/api/chores/{chore_id_to_keep}/merge/{chore_id_to_remove}")
async def merge_chores(
    chore_id_to_keep: int,
    chore_id_to_remove: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.merge_chores(chore_id_to_keep, chore_id_to_remove)


@router.get("/api/tasks")
async def list_tasks(
    _actor: CurrentActor,
    household: HouseholdSvc,
    include_done: Annotated[bool, Query()] = False,
) -> list[dict[str, Any]]:
    return await household.list_tasks(include_done=include_done)


@router.post("/api/tasks/{task_id}/complete")
async def complete_task(
    task_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.complete_task(task_id)


@router.post("/api/tasks/{task_id}/undo")
async def undo_task(
    task_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.undo_task(task_id)


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
) -> dict[str, Any]:
    return await household.charge_battery(battery_id)


@router.post("/api/batteries/charge-cycles/{charge_cycle_id}/undo")
async def undo_battery_charge(
    charge_cycle_id: int,
    _actor: CurrentActor,
    household: HouseholdSvc,
) -> dict[str, Any]:
    return await household.undo_battery_charge(charge_cycle_id)
