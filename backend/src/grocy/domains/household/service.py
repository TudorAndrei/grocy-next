"""Chore, task, and battery operations from the Grocy 4.5.0 household services."""

from __future__ import annotations

import random
from decimal import Decimal
from typing import Any

from sqlalchemy import String, delete, insert, select, type_coerce, update
from sqlalchemy.engine import Connection, CursorResult
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Executable

from grocy.compatibility.input import database_error
from grocy.compatibility.lessql import filtered, query_rows
from grocy.compatibility.php import (
    argument_error,
    coerced_float,
    coerced_int,
    empty,
    find,
    identical,
    loose_equals,
    pdo_parameter,
    php_date,
    php_error,
    php_string,
    truthy,
)
from grocy.core.actor import Actor
from grocy.core.errors import GrocyError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.db.models.base import Base
from grocy.db.models.household import Battery, BatteryChargeCycle, Chore, ChoreLog, Task
from grocy.domains.stock.service import StockService


def _quoted(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    return php_string(value)


def _stored(value: Any) -> Any:
    return type_coerce(_quoted(value), String())


def _in_transaction(connection: Connection) -> bool:
    driver = connection.connection.driver_connection
    return driver is not None and bool(driver.in_transaction)


class HouseholdService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _rows(self, statement: str, *parameters: Any) -> list[dict[str, Any]]:
        connection = await self.session.connection()
        result = await connection.exec_driver_sql(statement, parameters)
        return [dict(row) for row in result.mappings()]

    async def _row(self, statement: str, *parameters: Any) -> dict[str, Any] | None:
        rows = await self._rows(statement, *parameters)
        return rows[0] if rows else None

    async def _value(self, statement: str, *parameters: Any) -> Any:
        connection = await self.session.connection()
        return (await connection.exec_driver_sql(statement, parameters)).scalar()

    async def _write(self, statement: Executable) -> CursorResult[Any]:
        connection = await self.session.connection()
        return await connection.execute(statement)

    async def _update_row(self, model: type[Base], row: dict[str, Any], **values: Any) -> None:
        changes = {
            name: _stored(value)
            for name, value in values.items()
            if row.get(name) is None or not identical(row[name], value)
        }
        if changes:
            await self._write(
                update(model).where(model.__table__.c.id == row["id"]).values(**changes)
            )
        await self.session.commit()

    async def users(self) -> list[dict[str, Any]]:
        return await self._rows("SELECT * FROM `users_dto`")

    async def _exists(self, model: type[Chore] | type[Battery], identifier: Any) -> bool:
        connection = await self.session.connection()
        result = await connection.execute(select(model.id).where(model.id == identifier))
        return result.first() is not None

    async def current_chores(self, parameters: dict[Any, Any]) -> list[dict[str, Any]]:
        await configure_compatibility_queries(self.session)
        if filtered(parameters):
            return await query_rows(self.session, "chores_current", parameters)
        users = await self.users()
        chores = await self._rows("SELECT * FROM `chores_current`")
        for chore in chores:
            assigned = chore["next_execution_assigned_to_user_id"]
            chore["next_execution_assigned_user"] = (
                None if empty(assigned) else find(users, "id", assigned)
            )
        return chores

    async def chore_details(self, chore_id: int) -> dict[str, Any]:
        identifier = str(chore_id)
        chore = await self._row("SELECT * FROM `chores` WHERE `id` = ?", identifier)
        if chore is None:
            raise GrocyError("Chore does not exist", code=None)
        await configure_compatibility_queries(self.session)
        users = await self.users()
        completed = "chore_id = ? AND undone = 0 AND skipped = 0"
        last_tracked = await self._value(
            f"SELECT MAX(tracked_time) FROM `chores_log` WHERE ({completed})", identifier
        )
        last = await self._row(
            "SELECT * FROM `chores_log` WHERE (chore_id = ? AND tracked_time = ? AND undone = 0)",
            identifier,
            last_tracked,
        )
        assigned = chore["next_execution_assigned_to_user_id"]
        return {
            "chore": chore,
            "last_tracked": last_tracked,
            "tracked_count": await self._value(
                f"SELECT COUNT(*) FROM `chores_log` WHERE ({completed})", identifier
            ),
            "last_done_by": None if last is None else find(users, "id", last["done_by_user_id"]),
            "next_estimated_execution_time": await self._value(
                "SELECT MIN(next_estimated_execution_time) FROM `chores_current` "
                "WHERE (`chore_id` = ?)",
                identifier,
            ),
            "next_execution_assigned_user": (
                None if empty(assigned) else find(users, "id", assigned)
            ),
            "average_execution_frequency_hours": await self._value(
                "SELECT MIN(average_frequency_hours) FROM `chores_execution_average_frequency` "
                "WHERE (`chore_id` = ?)",
                identifier,
            ),
        }

    async def chore_execution(self, execution_id: int) -> dict[str, Any] | None:
        return await self._row("SELECT * FROM `chores_log` WHERE `id` = ?", str(execution_id))

    async def _user(self, value: Any) -> dict[str, Any] | None:
        if isinstance(value, (list, dict)):
            values = list(value.values()) if isinstance(value, dict) else value
            if len(values) != 1:
                raise GrocyError(
                    "SQLSTATE[HY000]: General error: 25 column index out of range", code=None
                )
            value = values[0]
        return await self._row("SELECT * FROM `users` WHERE (id = ?)", pdo_parameter(value))

    async def track_chore(
        self, actor: Actor, chore_id: int, tracked_time: str, done_by: Any, skipped: Any
    ) -> int:
        chore = await self._row("SELECT * FROM `chores` WHERE `id` = ?", str(chore_id))
        if chore is None:
            raise GrocyError("Chore does not exist", code=None)
        if await self._user(done_by) is None:
            raise GrocyError("User does not exist", code=None)
        if loose_equals(chore["track_date_only"], 1):
            tracked_time = tracked_time[:10] + " 00:00:00"
        if truthy(skipped) and loose_equals(chore["period_type"], "manually"):
            raise GrocyError("Chores without a schedule can't be skipped", code=None)
        await configure_compatibility_queries(self.session)
        current = await self._row(
            "SELECT * FROM `chores_current` WHERE (chore_id = ?)", pdo_parameter(chore["id"])
        )
        if isinstance(done_by, (list, dict)):
            raise php_error(
                "PDO::quote(): Argument #1 ($string) must be of type string, array given"
            )
        result = await self._write(
            insert(ChoreLog).values(
                chore_id=_stored(chore_id),
                tracked_time=_stored(tracked_time),
                done_by_user_id=_stored(done_by),
                skipped=_stored(1 if truthy(skipped) else 0),
                scheduled_execution_time=_stored(
                    None if current is None else current["next_estimated_execution_time"]
                ),
            )
        )
        execution_id = result.lastrowid
        await self.session.commit()
        if loose_equals(chore["consume_product_on_execution"], 1) and not empty(
            chore["product_id"]
        ):
            await self._consume(actor, chore)
        if not empty(chore["rescheduled_date"]):
            await self._write(
                update(Chore).where(Chore.id == chore["id"]).values(rescheduled_date=None)
            )
        if not empty(chore["rescheduled_next_execution_assigned_to_user_id"]):
            await self._write(
                update(Chore)
                .where(Chore.id == chore["id"])
                .values(rescheduled_next_execution_assigned_to_user_id=None)
            )
        await self.session.commit()
        await self.calculate_next_execution_assignment(chore_id)
        return execution_id

    async def _consume(self, actor: Actor, chore: dict[str, Any]) -> None:
        product_id = coerced_int(php_string(chore["product_id"]))
        if product_id is None:
            raise argument_error(
                "Grocy\\Services\\StockService::ConsumeProduct",
                1,
                "productId",
                "int",
                chore["product_id"],
            )
        amount = chore["product_amount"]
        value = amount if isinstance(amount, (int, float)) else coerced_float(php_string(amount))
        if value is None:
            raise argument_error(
                "Grocy\\Services\\StockService::ConsumeProduct", 2, "amount", "float", amount
            )
        try:
            await StockService(self.session).consume(
                actor,
                product_id,
                Decimal(repr(float(value))),
                exact_amount=False,
                allow_subproduct_substitution=True,
                commit=False,
            )
        except GrocyError as error:
            await self.session.rollback()
            if error.details is None:
                raise GrocyError(error.message, code=None) from error
            raise
        await self.session.commit()

    async def calculate_next_execution_assignment(self, chore_id: Any) -> None:
        chore = await self._row("SELECT * FROM `chores` WHERE `id` = ?", pdo_parameter(chore_id))
        if chore is None:
            raise GrocyError("Chore does not exist", code=None)
        assigned = chore["rescheduled_next_execution_assigned_to_user_id"]
        if empty(assigned):
            assigned = await self._next_assignee(chore)
        current = chore["next_execution_assigned_to_user_id"]
        if current is None or not identical(current, assigned):
            await self._write(
                update(Chore)
                .where(Chore.id == chore["id"])
                .values(next_execution_assigned_to_user_id=_stored(assigned))
            )
        await self.session.commit()

    async def calculate_next_execution_assignments(self, chore_id: int | None) -> None:
        if chore_id is not None:
            await self.calculate_next_execution_assignment(chore_id)
            return
        for chore in await self._rows("SELECT * FROM `chores`"):
            await self.calculate_next_execution_assignment(chore["id"])

    async def _next_assignee(self, chore: dict[str, Any]) -> Any:
        identifier = pdo_parameter(chore["id"])
        last_tracked = await self._value(
            "SELECT MAX(tracked_time) FROM `chores_log` WHERE (chore_id = ? AND undone = 0)",
            identifier,
        )
        last = await self._row(
            "SELECT * FROM `chores_log` WHERE (chore_id = ? AND tracked_time = ? AND undone = 0) "
            "ORDER BY `row_created_timestamp` DESC",
            identifier,
            last_tracked,
        )
        configuration = chore["assignment_config"]
        parts = php_string(configuration).split(",")
        users = [
            user
            for user in await self.users()
            if not empty(configuration) and any(loose_equals(user["id"], part) for part in parts)
        ]
        kind = chore["assignment_type"]
        if loose_equals(kind, "random"):
            if not users:
                raise php_error("array_rand(): Argument #1 ($array) must not be empty")
            return users[0]["id"] if len(users) == 1 else random.choice(users)["id"]
        if loose_equals(kind, "in-alphabetical-order"):
            users.sort(key=lambda user: php_string(user["display_name"]).encode())
            last_done_by = None if last is None else last["done_by_user_id"]
            following = False
            for user in users:
                if following:
                    return user["id"]
                following = loose_equals(user["id"], last_done_by)
            return users[0]["id"] if users else None
        if loose_equals(kind, "who-least-did-first"):
            row = await self._row(
                "SELECT * FROM `chores_execution_users_statistics` WHERE (chore_id = ?) "
                "ORDER BY `execution_count` ASC LIMIT 1",
                identifier,
            )
            return None if row is None else row["user_id"]
        return None

    async def undo_chore_execution(self, execution_id: str) -> None:
        execution = await self._row(
            "SELECT * FROM `chores_log` WHERE (id = ? AND undone = 0)", execution_id
        )
        if execution is None:
            raise GrocyError("Execution does not exist or was already undone", code=None)
        await self._update_row(ChoreLog, execution, undone=1, undone_timestamp=php_date())
        await self.calculate_next_execution_assignment(execution["chore_id"])

    async def merge_chores(self, keep_id: int, remove_id: int) -> None:
        if not await self._exists(Chore, keep_id):
            raise GrocyError("$choreIdToKeep does not exist or is inactive", code=None)
        if not await self._exists(Chore, remove_id):
            raise GrocyError("$choreIdToRemove does not exist or is inactive", code=None)
        if keep_id == remove_id:
            raise GrocyError("$choreIdToKeep cannot equal $choreIdToRemove", code=None)
        await self.session.commit()
        connection = await self.session.connection()
        try:
            await connection.execute(
                update(ChoreLog).where(ChoreLog.chore_id == remove_id).values(chore_id=keep_id)
            )
            await connection.execute(delete(Chore).where(Chore.id == remove_id))
        except DBAPIError as error:
            active = await connection.run_sync(_in_transaction)
            await self.session.rollback()
            if not active:
                raise GrocyError("There is no active transaction", code=None) from error
            raise GrocyError(database_error(error).message, code=None) from error
        await self.session.commit()

    async def current_tasks(self, parameters: dict[Any, Any]) -> list[dict[str, Any]]:
        await configure_compatibility_queries(self.session)
        if filtered(parameters):
            return await query_rows(self.session, "tasks_current", parameters)
        users = await self.users()
        categories = await self._rows("SELECT * FROM `task_categories` WHERE (active = 1)")
        tasks = await self._rows("SELECT * FROM `tasks_current`")
        for task in tasks:
            assigned, category = task["assigned_to_user_id"], task["category_id"]
            task["assigned_to_user"] = None if empty(assigned) else find(users, "id", assigned)
            task["category"] = None if empty(category) else find(categories, "id", category)
        return tasks

    async def mark_task_completed(self, task_id: str, done_time: str) -> None:
        task = await self._row("SELECT * FROM `tasks` WHERE (id = ?)", task_id)
        if task is None:
            raise GrocyError("Task does not exist", code=None)
        await self._update_row(Task, task, done=1, done_timestamp=done_time)

    async def undo_task(self, task_id: str) -> None:
        task = await self._row("SELECT * FROM `tasks` WHERE (id = ?)", task_id)
        if task is None:
            raise GrocyError("Task does not exist", code=None)
        await self._update_row(Task, task, done=0, done_timestamp=None)

    async def current_batteries(self, parameters: dict[Any, Any]) -> list[dict[str, Any]]:
        await configure_compatibility_queries(self.session)
        if filtered(parameters):
            return await query_rows(self.session, "batteries_current", parameters)
        batteries = await self._rows(
            "SELECT * FROM `batteries` WHERE (active = 1) ORDER BY `name` COLLATE NOCASE"
        )
        rows = await self._rows("SELECT * FROM `batteries_current`")
        for row in rows:
            row["battery"] = find(batteries, "id", row["battery_id"])
        return rows

    async def battery_details(self, battery_id: int) -> dict[str, Any]:
        identifier = str(battery_id)
        battery = await self._row("SELECT * FROM `batteries` WHERE `id` = ?", identifier)
        if battery is None:
            raise GrocyError("Battery does not exist", code=None)
        await configure_compatibility_queries(self.session)
        cycles = "battery_id = ? AND undone = 0"
        return {
            "battery": battery,
            "last_charged": await self._value(
                f"SELECT MAX(tracked_time) FROM `battery_charge_cycles` WHERE ({cycles})",
                identifier,
            ),
            "charge_cycles_count": await self._value(
                f"SELECT COUNT(*) FROM `battery_charge_cycles` WHERE ({cycles})", identifier
            ),
            "next_estimated_charge_time": await self._value(
                "SELECT MIN(next_estimated_charge_time) FROM `batteries_current` "
                "WHERE (`battery_id` = ?)",
                identifier,
            ),
        }

    async def track_charge_cycle(self, battery_id: int, tracked_time: str) -> int:
        if not await self._exists(Battery, battery_id):
            raise GrocyError("Battery does not exist", code=None)
        result = await self._write(
            insert(BatteryChargeCycle).values(
                battery_id=_stored(battery_id), tracked_time=_stored(tracked_time)
            )
        )
        await self.session.commit()
        return result.lastrowid

    async def charge_cycle(self, charge_cycle_id: int) -> dict[str, Any] | None:
        return await self._row(
            "SELECT * FROM `battery_charge_cycles` WHERE `id` = ?", str(charge_cycle_id)
        )

    async def undo_charge_cycle(self, charge_cycle_id: str) -> None:
        cycle = await self._row(
            "SELECT * FROM `battery_charge_cycles` WHERE (id = ? AND undone = 0)", charge_cycle_id
        )
        if cycle is None:
            raise GrocyError("Charge cycle does not exist or was already undone", code=None)
        await self._update_row(BatteryChargeCycle, cycle, undone=1, undone_timestamp=php_date())
