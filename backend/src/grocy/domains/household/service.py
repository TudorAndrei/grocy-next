from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.users import user_dto
from grocy.core.actor import Actor
from grocy.core.errors import GrocyError
from grocy.db.models.household import (
    Battery,
    BatteryChargeCycle,
    Chore,
    ChoreLog,
    Task,
    TaskCategory,
)
from grocy.db.models.users import User
from grocy.db.types import database_time
from grocy.domains.household.schedule import UNSCHEDULED, next_execution
from grocy.domains.stock.service import StockService


def _datetime(value: date | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.combine(value, datetime.min.time())


class HouseholdService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_chores(self) -> list[dict]:
        rows = (
            (
                await self.session.execute(
                    select(Chore).where(Chore.active == 1).order_by(Chore.name)
                )
            )
            .scalars()
            .all()
        )
        result = []
        for chore in rows:
            logs = await self._chore_logs(chore.id)
            last = logs[-1].tracked_time if logs else None
            assigned = chore.next_execution_assigned_to_user_id
            result.append(
                {
                    **self._serialize_chore(chore),
                    "chore_id": chore.id,
                    "chore_name": chore.name,
                    "is_rescheduled": bool(chore.rescheduled_date),
                    "is_reassigned": bool(chore.rescheduled_next_execution_assigned_to_user_id),
                    "next_execution_assigned_to_user_id": assigned,
                    "next_execution_assigned_user": await self._user(assigned),
                    "last_tracked_time": database_time(last) if last else None,
                    "next_estimated_execution_time": await self._next_chore_time(chore, logs),
                }
            )
        return result

    async def get_chore(self, chore_id: int) -> dict:
        chore = await self._require_chore(chore_id)
        logs = await self._chore_logs(chore_id)
        completed = [log for log in logs if not log.skipped]
        last = completed[-1] if completed else None
        assigned = chore.next_execution_assigned_to_user_id
        return {
            "chore": self._serialize_chore(chore),
            "last_tracked": database_time(last.tracked_time) if last else None,
            "last_tracked_time": database_time(last.tracked_time) if last else None,
            "tracked_count": len(completed),
            "track_count": len(completed),
            "last_done_by": await self._user(last.done_by_user_id if last else None),
            "next_estimated_execution_time": await self._next_chore_time(chore, logs),
            "next_execution_assigned_user": await self._user(assigned),
            "average_execution_frequency_hours": await self._average_frequency(chore_id),
        }

    async def execute_chore(
        self,
        actor: Actor,
        chore_id: int,
        *,
        tracked_time: date | datetime | None = None,
        done_by: int | None = None,
        skipped: bool = False,
    ) -> dict:
        chore = await self._require_chore(chore_id)
        user_id = done_by if done_by is not None else actor.user_id
        if await self.session.get(User, user_id) is None:
            raise GrocyError("User not found")
        if skipped and chore.period_type == "manually":
            raise GrocyError("Chores without a schedule cannot be skipped")
        tracked = tracked_time or datetime.now().replace(microsecond=0)
        if isinstance(tracked, datetime) and tracked.tzinfo is not None:
            tracked = tracked.astimezone().replace(tzinfo=None)
        if chore.track_date_only:
            tracked = datetime.combine(tracked, datetime.min.time())
        due = await self._next_chore_time(chore, await self._chore_logs(chore_id))
        log = ChoreLog(
            chore_id=chore_id,
            tracked_time=tracked,
            done_by_user_id=user_id,
            skipped=int(skipped),
            scheduled_execution_time=datetime.fromisoformat(due) if due else None,
        )
        self.session.add(log)
        # Grocy saves the execution before it attempts the separate stock booking.
        await self.session.commit()
        try:
            if chore.consume_product_on_execution and chore.product_id and chore.product_amount:
                await StockService(self.session).consume(
                    actor,
                    chore.product_id,
                    chore.product_amount,
                    exact_amount=False,
                    allow_subproduct_substitution=True,
                    commit=False,
                )
            chore.rescheduled_date = None
            chore.rescheduled_next_execution_assigned_to_user_id = None
            await self._assign_chore(chore)
            await self.session.commit()
            await self.session.refresh(log)
        except Exception:
            await self.session.rollback()
            raise
        return {
            "id": log.id,
            "chore_id": chore_id,
            "tracked_time": database_time(log.tracked_time),
            "done_by_user_id": log.done_by_user_id,
            "skipped": bool(log.skipped),
            "undone": log.undone,
            "undone_timestamp": None,
            "scheduled_execution_time": due,
            "row_created_timestamp": log.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }

    async def undo_chore_execution(self, execution_id: int) -> dict:
        log = await self.session.get(ChoreLog, execution_id)
        if log is None:
            raise GrocyError(f"Chore execution {execution_id} not found")
        if log.undone:
            raise GrocyError("already undone", code="already_undone")
        log.undone = 1
        log.undone_timestamp = datetime.now()
        await self.session.flush()
        await self._assign_chore(await self._require_chore(log.chore_id))
        await self.session.commit()
        return {"id": execution_id, "undone": True}

    async def list_tasks(self, *, include_done: bool = False) -> list[dict]:
        stmt = select(Task).order_by(Task.due_date.is_(None), Task.due_date.asc(), Task.id)
        if not include_done:
            stmt = stmt.where(Task.done == 0)
        rows = (await self.session.execute(stmt)).scalars().all()
        result = []
        for row in rows:
            category = (
                await self.session.get(TaskCategory, row.category_id) if row.category_id else None
            )
            result.append(
                {
                    **self._serialize_task(row),
                    "assigned_to_user": await self._user(row.assigned_to_user_id),
                    "category": {
                        "id": category.id,
                        "name": category.name,
                        "description": category.description,
                        "active": category.active,
                        "row_created_timestamp": category.row_created_timestamp.isoformat(
                            sep=" ", timespec="seconds"
                        ),
                    }
                    if category and category.active
                    else None,
                }
            )
        return result

    async def complete_task(self, task_id: int, *, done_time: datetime | None = None) -> dict:
        task = await self.session.get(Task, task_id)
        if task is None:
            raise GrocyError(f"Task {task_id} not found")
        task.done = 1
        task.done_timestamp = done_time or datetime.now().replace(microsecond=0)
        await self.session.commit()
        return self._serialize_task(task)

    async def undo_task(self, task_id: int) -> dict:
        task = await self.session.get(Task, task_id)
        if task is None:
            raise GrocyError(f"Task {task_id} not found")
        task.done = 0
        task.done_timestamp = None
        await self.session.commit()
        return self._serialize_task(task)

    async def list_batteries(self) -> list[dict]:
        rows = (
            (
                await self.session.execute(
                    select(Battery).where(Battery.active == 1).order_by(Battery.name)
                )
            )
            .scalars()
            .all()
        )
        result = []
        for battery in rows:
            last = await self._last_battery_charge(battery.id)
            result.append(
                {
                    **self._serialize_battery(battery),
                    "battery_id": battery.id,
                    "battery": self._serialize_battery(battery),
                    "last_tracked_time": database_time(last) if last else None,
                    "next_estimated_charge_time": self._next_battery_time(battery, last),
                }
            )
        return result

    async def get_battery(self, battery_id: int) -> dict:
        battery = await self.session.get(Battery, battery_id)
        if battery is None:
            raise GrocyError(f"Battery {battery_id} not found")
        last = await self._last_battery_charge(battery_id)
        return {
            "battery": self._serialize_battery(battery),
            "last_tracked_time": database_time(last) if last else None,
            "last_charged": database_time(last) if last else None,
            "charge_cycles_count": await self.session.scalar(
                select(func.count())
                .select_from(BatteryChargeCycle)
                .where(BatteryChargeCycle.battery_id == battery_id, BatteryChargeCycle.undone == 0)
            ),
            "next_estimated_charge_time": self._next_battery_time(battery, last),
        }

    async def merge_chores(self, keep_id: int, remove_id: int) -> dict:
        keep = await self.session.get(Chore, keep_id)
        remove = await self.session.get(Chore, remove_id)
        if keep is None:
            raise GrocyError(f"Chore {keep_id} not found")
        if remove is None:
            raise GrocyError(f"Chore {remove_id} not found")
        if keep_id == remove_id:
            raise GrocyError("cannot merge chore into itself", code="invalid_merge")
        logs = (
            (await self.session.execute(select(ChoreLog).where(ChoreLog.chore_id == remove_id)))
            .scalars()
            .all()
        )
        for log in logs:
            log.chore_id = keep_id
        await self.session.delete(remove)
        await self.session.commit()
        return {"kept_chore_id": keep_id, "removed_chore_id": remove_id}

    async def calculate_next_assignments(self, chore_id: int | None = None) -> dict:
        if chore_id is not None:
            chores = [await self._require_chore(chore_id)]
        else:
            chores = list((await self.session.execute(select(Chore))).scalars().all())
        for chore in chores:
            await self._assign_chore(chore)
        await self.session.commit()
        return {"assignments": await self.list_chores(), "calculated": True}

    async def _assign_chore(self, chore: Chore) -> None:
        if chore.rescheduled_next_execution_assigned_to_user_id:
            chore.next_execution_assigned_to_user_id = (
                chore.rescheduled_next_execution_assigned_to_user_id
            )
            return
        ids = {
            int(part.strip())
            for part in (chore.assignment_config or "").split(",")
            if part.strip().isdigit()
        }
        users = (await self.session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
        candidates = sorted(
            users, key=lambda u: f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
        )
        assigned = None
        if candidates and chore.assignment_type != "no-assignment":
            logs = await self._chore_logs(chore.id)
            if chore.assignment_type == "random":
                assigned = secrets.choice(candidates).id
            elif chore.assignment_type == "who-least-did-first":
                counts = {
                    user.id: sum(log.done_by_user_id == user.id for log in logs)
                    for user in candidates
                }
                assigned = min(candidates, key=lambda u: (counts[u.id], u.id)).id
            else:
                last_user = logs[-1].done_by_user_id if logs else None
                index = next((i for i, user in enumerate(candidates) if user.id == last_user), -1)
                assigned = candidates[(index + 1) % len(candidates)].id
        chore.next_execution_assigned_to_user_id = assigned

    async def charge_battery(
        self, battery_id: int, *, tracked_time: datetime | None = None
    ) -> dict:
        battery = await self.session.get(Battery, battery_id)
        if battery is None:
            raise GrocyError(f"Battery {battery_id} not found")
        cycle = BatteryChargeCycle(
            battery_id=battery_id,
            tracked_time=tracked_time or datetime.now().replace(microsecond=0),
        )
        self.session.add(cycle)
        await self.session.commit()
        await self.session.refresh(cycle)
        return {
            "id": cycle.id,
            "battery_id": battery_id,
            "tracked_time": cycle.tracked_time.isoformat(sep=" ", timespec="seconds"),
            "undone": cycle.undone,
            "undone_timestamp": None,
            "row_created_timestamp": cycle.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }

    async def undo_battery_charge(self, charge_cycle_id: int) -> dict:
        cycle = await self.session.get(BatteryChargeCycle, charge_cycle_id)
        if cycle is None:
            raise GrocyError(f"Charge cycle {charge_cycle_id} not found")
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

    async def _require_chore(self, chore_id: int) -> Chore:
        chore = await self.session.get(Chore, chore_id)
        if chore is None:
            raise GrocyError(f"Chore {chore_id} not found")
        return chore

    async def _chore_logs(self, chore_id: int) -> list[ChoreLog]:
        return list(
            (
                await self.session.execute(
                    select(ChoreLog)
                    .where(ChoreLog.chore_id == chore_id, ChoreLog.undone == 0)
                    .order_by(ChoreLog.tracked_time, ChoreLog.id)
                )
            )
            .scalars()
            .all()
        )

    async def _user(self, user_id: int | None) -> dict | None:
        if user_id is None:
            return None
        user = await self.session.get(User, user_id)
        if user is None:
            return None
        return user_dto(user)

    async def _average_frequency(self, chore_id: int) -> float | None:
        # Keep SQLite's floating point calculation and integer truncation.
        return await self.session.scalar(
            text("""
                SELECT AVG(CAST((JULIANDAY(current.tracked_time) - JULIANDAY((
                    SELECT previous.tracked_time FROM chores_log previous
                    WHERE previous.chore_id = current.chore_id AND previous.undone = 0
                        AND previous.tracked_time < current.tracked_time
                    ORDER BY previous.tracked_time DESC LIMIT 1
                ))) * 24 AS INT))
                FROM chores_log current
                WHERE current.chore_id = :chore_id AND current.undone = 0
            """),
            {"chore_id": chore_id},
        )

    async def _next_chore_time(self, chore: Chore, logs: list[ChoreLog]) -> str | None:
        if not chore.active:
            return None
        last = _datetime(logs[-1].tracked_time) if logs else None
        weekly_last = None
        if chore.period_type == "weekly" and last is not None:
            # Grocy 4.5.0's weekly SQL subquery includes undone executions.
            weekly_last = await self.session.scalar(
                select(func.max(ChoreLog.tracked_time)).where(ChoreLog.chore_id == chore.id)
            )
        if weekly_last is not None:
            weekly_last = _datetime(weekly_last)
        due = next_execution(
            chore,
            last,
            await self._average_frequency(chore.id),
            datetime.now(),
            weekly_last=weekly_last,
        )
        return due.isoformat(sep=" ", timespec="seconds") if due else None

    def _next_battery_time(self, battery: Battery, last: datetime | None) -> str | None:
        if not battery.active:
            return None
        if not battery.charge_interval_days:
            return UNSCHEDULED.isoformat(sep=" ", timespec="seconds")
        return (
            (last + timedelta(days=battery.charge_interval_days)).isoformat(
                sep=" ", timespec="seconds"
            )
            if last
            else None
        )

    def _serialize_chore(self, chore: Chore) -> dict:
        return {
            column.name: value.isoformat(sep=" ", timespec="seconds")
            if isinstance(value, datetime)
            else float(value)
            if hasattr(value, "as_tuple")
            else value
            for column in chore.__table__.columns
            for value in [getattr(chore, column.name)]
        }

    def _serialize_task(self, task: Task) -> dict:
        return {
            "id": task.id,
            "name": task.name,
            "description": task.description,
            "due_date": task.due_date.isoformat(sep=" ", timespec="seconds")
            if task.due_date
            else None,
            "done": task.done,
            "done_timestamp": task.done_timestamp.isoformat(sep=" ", timespec="seconds")
            if task.done_timestamp
            else None,
            "category_id": task.category_id,
            "assigned_to_user_id": task.assigned_to_user_id,
            "row_created_timestamp": task.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }

    def _serialize_battery(self, battery: Battery) -> dict:
        return {
            "id": battery.id,
            "name": battery.name,
            "description": battery.description,
            "used_in": battery.used_in,
            "charge_interval_days": battery.charge_interval_days,
            "active": battery.active,
            "row_created_timestamp": battery.row_created_timestamp.isoformat(
                sep=" ", timespec="seconds"
            ),
        }
