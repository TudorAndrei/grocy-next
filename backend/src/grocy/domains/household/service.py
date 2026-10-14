from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.core.errors import GrocyError, NotFoundError
from grocy.db.models.household import (
    Battery,
    BatteryChargeCycle,
    Chore,
    ChoreLog,
    Task,
    TaskCategory,
)


class HouseholdService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_chores(self) -> list[dict]:
        rows = (
            await self.session.execute(select(Chore).order_by(Chore.name))
        ).scalars().all()
        result = []
        for chore in rows:
            last = await self._last_chore_execution(chore.id)
            result.append(
                {
                    **self._serialize_chore(chore),
                    "last_tracked_time": last.isoformat() if last else None,
                    "next_estimated_execution_time": self._next_chore_time(chore, last),
                }
            )
        return result

    async def get_chore(self, chore_id: int) -> dict:
        chore = await self.session.get(Chore, chore_id)
        if chore is None:
            raise NotFoundError(f"Chore {chore_id} not found")
        last = await self._last_chore_execution(chore_id)
        return {
            "chore": self._serialize_chore(chore),
            "last_tracked_time": last.isoformat() if last else None,
            "next_estimated_execution_time": self._next_chore_time(chore, last),
        }

    async def execute_chore(self, actor: Actor, chore_id: int) -> dict:
        chore = await self.session.get(Chore, chore_id)
        if chore is None:
            raise NotFoundError(f"Chore {chore_id} not found")
        log = ChoreLog(
            chore_id=chore_id,
            tracked_time=datetime.now(),
            done_by_user_id=actor.user_id,
        )
        self.session.add(log)
        await self.session.commit()
        await self.session.refresh(log)
        return {
            "id": log.id,
            "chore_id": chore_id,
            "tracked_time": log.tracked_time.isoformat(),
            "done_by_user_id": actor.user_id,
        }

    async def undo_chore_execution(self, execution_id: int) -> dict:
        log = await self.session.get(ChoreLog, execution_id)
        if log is None:
            raise NotFoundError(f"Chore execution {execution_id} not found")
        if log.undone:
            raise GrocyError("already undone", code="already_undone")
        log.undone = 1
        log.undone_timestamp = datetime.now()
        await self.session.commit()
        return {"id": execution_id, "undone": True}

    async def list_tasks(self, *, include_done: bool = False) -> list[dict]:
        stmt = select(Task).order_by(Task.due_date.is_(None), Task.due_date.asc(), Task.id)
        if not include_done:
            stmt = stmt.where(Task.done == 0)
        rows = (await self.session.execute(stmt)).scalars().all()
        return [self._serialize_task(row) for row in rows]

    async def complete_task(self, task_id: int) -> dict:
        task = await self.session.get(Task, task_id)
        if task is None:
            raise NotFoundError(f"Task {task_id} not found")
        task.done = 1
        task.done_timestamp = datetime.now()
        await self.session.commit()
        return self._serialize_task(task)

    async def undo_task(self, task_id: int) -> dict:
        task = await self.session.get(Task, task_id)
        if task is None:
            raise NotFoundError(f"Task {task_id} not found")
        task.done = 0
        task.done_timestamp = None
        await self.session.commit()
        return self._serialize_task(task)

    async def list_batteries(self) -> list[dict]:
        rows = (
            await self.session.execute(select(Battery).order_by(Battery.name))
        ).scalars().all()
        result = []
        for battery in rows:
            last = await self._last_battery_charge(battery.id)
            result.append(
                {
                    **self._serialize_battery(battery),
                    "last_tracked_time": last.isoformat() if last else None,
                }
            )
        return result

    async def get_battery(self, battery_id: int) -> dict:
        battery = await self.session.get(Battery, battery_id)
        if battery is None:
            raise NotFoundError(f"Battery {battery_id} not found")
        last = await self._last_battery_charge(battery_id)
        return {
            "battery": self._serialize_battery(battery),
            "last_tracked_time": last.isoformat() if last else None,
            "next_estimated_charge_time": self._next_battery_time(battery, last),
        }

    async def merge_chores(self, keep_id: int, remove_id: int) -> dict:
        keep = await self.session.get(Chore, keep_id)
        remove = await self.session.get(Chore, remove_id)
        if keep is None:
            raise NotFoundError(f"Chore {keep_id} not found")
        if remove is None:
            raise NotFoundError(f"Chore {remove_id} not found")
        if keep_id == remove_id:
            raise GrocyError("cannot merge chore into itself", code="invalid_merge")
        logs = (
            await self.session.execute(select(ChoreLog).where(ChoreLog.chore_id == remove_id))
        ).scalars().all()
        for log in logs:
            log.chore_id = keep_id
        await self.session.delete(remove)
        await self.session.commit()
        return {"kept_chore_id": keep_id, "removed_chore_id": remove_id}

    async def calculate_next_assignments(self) -> dict:
        chores = await self.list_chores()
        return {"assignments": chores, "calculated": True}

    async def charge_battery(self, battery_id: int) -> dict:
        battery = await self.session.get(Battery, battery_id)
        if battery is None:
            raise NotFoundError(f"Battery {battery_id} not found")
        cycle = BatteryChargeCycle(battery_id=battery_id, tracked_time=datetime.now())
        self.session.add(cycle)
        await self.session.commit()
        await self.session.refresh(cycle)
        return {
            "id": cycle.id,
            "battery_id": battery_id,
            "tracked_time": cycle.tracked_time.isoformat(),
        }

    async def undo_battery_charge(self, charge_cycle_id: int) -> dict:
        cycle = await self.session.get(BatteryChargeCycle, charge_cycle_id)
        if cycle is None:
            raise NotFoundError(f"Charge cycle {charge_cycle_id} not found")
        if cycle.undone:
            raise GrocyError("already undone", code="already_undone")
        cycle.undone = 1
        cycle.undone_timestamp = datetime.now()
        await self.session.commit()
        return {"id": charge_cycle_id, "undone": True}

    async def ensure_seed_defaults(self) -> None:
        if (await self.session.scalar(select(TaskCategory.id).limit(1))) is None:
            self.session.add(TaskCategory(name="General", description="Default"))
            await self.session.flush()

    async def _last_chore_execution(self, chore_id: int) -> datetime | None:
        stmt = (
            select(ChoreLog.tracked_time)
            .where(ChoreLog.chore_id == chore_id, ChoreLog.undone == 0)
            .order_by(ChoreLog.tracked_time.desc())
            .limit(1)
        )
        return await self.session.scalar(stmt)

    async def _last_battery_charge(self, battery_id: int) -> datetime | None:
        stmt = (
            select(BatteryChargeCycle.tracked_time)
            .where(
                BatteryChargeCycle.battery_id == battery_id,
                BatteryChargeCycle.undone == 0,
            )
            .order_by(BatteryChargeCycle.tracked_time.desc())
            .limit(1)
        )
        return await self.session.scalar(stmt)

    def _next_chore_time(self, chore: Chore, last: datetime | None) -> str | None:
        if chore.period_type == "manually" or not chore.period_days:
            return None
        base = last or datetime.now()
        return (base + timedelta(days=int(chore.period_days))).isoformat()

    def _next_battery_time(self, battery: Battery, last: datetime | None) -> str | None:
        if not battery.charge_interval_days:
            return None
        base = last or datetime.now()
        return (base + timedelta(days=int(battery.charge_interval_days))).isoformat()

    def _serialize_chore(self, chore: Chore) -> dict:
        return {
            "id": chore.id,
            "name": chore.name,
            "description": chore.description,
            "period_type": chore.period_type,
            "period_days": chore.period_days,
            "period_config": chore.period_config,
            "track_date_only": bool(chore.track_date_only),
            "rollover": bool(chore.rollover),
            "assignment_type": chore.assignment_type,
        }

    def _serialize_task(self, task: Task) -> dict:
        return {
            "id": task.id,
            "name": task.name,
            "description": task.description,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "done": task.done,
            "done_timestamp": task.done_timestamp.isoformat() if task.done_timestamp else None,
            "category_id": task.category_id,
            "assigned_to_user_id": task.assigned_to_user_id,
        }

    def _serialize_battery(self, battery: Battery) -> dict:
        return {
            "id": battery.id,
            "name": battery.name,
            "description": battery.description,
            "used_in": battery.used_in,
            "charge_interval_days": battery.charge_interval_days,
        }
