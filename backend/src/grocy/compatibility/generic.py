"""Execute native SQL with PDO statement and explicit transaction boundaries."""

from typing import Any

from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.sqlite_functions import register_sqlite_functions
from grocy.compatibility.values import encode_value
from grocy.db.compatibility_views import configure_compatibility_queries


class NativeStatements:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.transaction = False

    def _register_functions(self, connection: Connection) -> None:
        database: Any = connection.connection.dbapi_connection
        register_sqlite_functions(database)

    async def execute(self, step: dict[str, Any]) -> dict[str, Any]:
        context = step["context"]
        action, table = context["action"], context["table"]
        try:
            if action in {"begin", "commit", "rollback"}:
                return await self._change_transaction(action)
            await configure_compatibility_queries(self.session)
            connection = await self.session.connection()
            await connection.run_sync(self._register_functions)
            if table == "products" and action == "delete":
                before = (
                    (await connection.exec_driver_sql(context["before_query"])).mappings().all()
                )
                for row in before:
                    await self._delete_nutrition(row["id"])
            result = await connection.exec_driver_sql(step["query"])
            names = list(result.keys()) if result.returns_rows else []
            rows = []
            if result.returns_rows:
                for row in result:
                    actual = dict(zip(names, row, strict=True))
                    rows.append(
                        {
                            name: encode_value(actual[name] if name in actual else row[index])
                            for index, name in enumerate(step.get("columns") or names)
                        }
                    )
            response: dict[str, Any] = {
                "row_count": max(result.rowcount, 0),
                "rows": rows,
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
            number = getattr(error.orig, "sqlite_errorcode", 1) & 255
            state = (
                "23000]: Integrity constraint violation"
                if number == 19
                else "HY000]: General error"
            )
            failure: dict[str, Any] = {"error": f"SQLSTATE[{state}: {number} {error.orig}"}
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
