"""Execute native SQL with PDO statement and explicit transaction boundaries."""

import asyncio
import re
from typing import Any

from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.purifier import InputPurifier
from grocy.compatibility.values import encode_value
from grocy.db.compatibility_views import configure_compatibility_queries


class NativeStatements:
    def __init__(self, session: AsyncSession, runtime: InputPurifier) -> None:
        self.session = session
        self.runtime = runtime
        self.function_errors: list[dict[str, Any]] = []
        self.transaction = False

    def _register_functions(self, connection: Connection, loop: asyncio.AbstractEventLoop) -> None:
        runtime, errors = self.runtime, self.function_errors
        database: Any = connection.connection.dbapi_connection

        def invoke(name: str, arguments: tuple) -> Any:
            result = asyncio.run_coroutine_threadsafe(
                runtime.sqlite_function(name, arguments), loop
            ).result()
            if "error" in result:
                errors.append(result)
                raise ValueError(result["error"])
            return result["value"]

        database.create_function("regexp", 2, lambda *values: invoke("regexp", values))
        database.create_function("ceil", 1, lambda value: invoke("ceil", (value,)))

    async def execute(self, step: dict[str, Any]) -> dict[str, Any]:
        context = step["context"]
        action, table = context["action"], context["table"]
        parameters = step["parameters"]
        if isinstance(parameters, list):
            parameters = tuple(parameters)
        try:
            if action in {"begin", "commit", "rollback"}:
                return await self._change_transaction(action)
            await configure_compatibility_queries(self.session)
            connection = await self.session.connection()
            self.function_errors.clear()
            await connection.run_sync(self._register_functions, asyncio.get_running_loop())
            if table == "products" and action == "delete":
                before = (
                    (await connection.exec_driver_sql(context["before_query"], parameters))
                    .mappings()
                    .all()
                )
                for row in before:
                    await self._delete_nutrition(row["id"])
            try:
                result = await connection.exec_driver_sql(step["query"], parameters)
            except ProgrammingError as error:
                missing = re.fullmatch(
                    r"Incorrect number of bindings supplied\. The current statement uses (\d+), "
                    r"and there are (\d+) supplied\.",
                    str(error.orig),
                )
                if not isinstance(parameters, tuple) or missing is None:
                    raise
                required, supplied = map(int, missing.groups())
                if required < supplied:
                    if not self.transaction:
                        await self.session.rollback()
                    return {"error": "SQLSTATE[HY000]: General error: 25 column index out of range"}
                if required == supplied:
                    raise
                # PDO leaves omitted positional bindings null. SQLite's Python
                # driver rejects them before execution, so supply those nulls.
                result = await connection.exec_driver_sql(
                    step["query"], parameters + (None,) * (required - supplied)
                )
            response: dict[str, Any] = {
                "row_count": max(result.rowcount, 0),
                "rows": [
                    {name: encode_value(value) for name, value in row.items()}
                    for row in result.mappings()
                ]
                if result.returns_rows
                else []
            }
            if action in {"insert", "execute"} and result.rowcount > 0:
                response["insert_id"] = str(result.lastrowid)
            if action != "select" and not self.transaction:
                await self.session.commit()
                self.session.expire_all()
            return response
        except DBAPIError as error:
            aborted = False
            if self.transaction:
                connection = await self.session.connection()
                aborted = not await connection.run_sync(self._transaction_active)
                if aborted:
                    self.transaction = False
            if not self.transaction:
                await self.session.rollback()
            if self.function_errors:
                failure: dict[str, Any] = dict(self.function_errors[0])
            else:
                number = getattr(error.orig, "sqlite_errorcode", 1) & 255
                state = (
                    "23000]: Integrity constraint violation"
                    if number == 19
                    else "HY000]: General error"
                )
                failure = {"error": f"SQLSTATE[{state}: {number} {error.orig}"}
            if aborted:
                failure["transaction_aborted"] = True
            return failure

    async def _change_transaction(self, action: str) -> dict[str, Any]:
        if action == "begin":
            # Finish the authentication/read transaction before Grocy's own BEGIN.
            await self.session.commit()
            connection = await self.session.connection()
            await connection.exec_driver_sql("BEGIN")
            self.transaction = True
        else:
            connection = await self.session.connection()
            # PDO sends explicit SQL, including after SQLite has aborted the transaction.
            await connection.exec_driver_sql("COMMIT" if action == "commit" else "ROLLBACK")
            if action == "commit":
                await self.session.commit()
            else:
                await self.session.rollback()
            self.transaction = False
            self.session.expire_all()
        return {"rows": []}

    @staticmethod
    def _transaction_active(connection: Connection) -> bool:
        driver = connection.connection.driver_connection
        assert driver is not None
        return bool(driver.in_transaction)

    async def _delete_nutrition(self, product_id: int) -> None:
        connection = await self.session.connection()
        for table in ("nutrition_proposals", "nutrition_revisions"):
            await connection.exec_driver_sql(
                f'DELETE FROM "{table}" WHERE product_id=?', (product_id,)
            )
        await connection.exec_driver_sql(
            "DELETE FROM nutrition_evidence WHERE nutrition_id IN "
            "(SELECT id FROM product_nutrition WHERE product_id=?)",
            (product_id,),
        )
        await connection.exec_driver_sql(
            "DELETE FROM product_nutrition WHERE product_id=?", (product_id,)
        )
