from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.responses import native_action_response, native_list_response
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["household"])


@router.get("/api/chores")
async def list_chores(request: Request, _actor: CurrentActor, session: DbSession) -> Response:
    return await native_list_response(request, session, "chores")


@router.get("/api/chores/{chore_id}")
async def get_chore(
    chore_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "chore_details", chore_id, actor.user_id)


@router.post("/api/chores/{chore_id}/execute")
async def execute_chore(
    chore_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "chore_execute", chore_id, actor.user_id)


@router.post("/api/chores/executions/{execution_id}/undo", status_code=204)
async def undo_chore(
    execution_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "chore_undo", execution_id, actor.user_id)


@router.post("/api/chores/executions/calculate-next-assignments", status_code=204)
async def calculate_next_assignments(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "chore_assign", "", actor.user_id)


@router.post("/api/chores/{chore_id_to_keep}/merge/{chore_id_to_remove}", status_code=204)
async def merge_chores(
    chore_id_to_keep: str,
    chore_id_to_remove: str,
    request: Request,
    actor: AuthenticatedActor,
    session: DbSession,
) -> Response:
    return await native_action_response(
        request,
        session,
        "chore_merge",
        chore_id_to_keep,
        actor.user_id,
        arguments={"remove_id": chore_id_to_remove},
    )


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
