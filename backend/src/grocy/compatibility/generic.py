"""Execute pinned LessQL statements with PDO's per-statement commit behavior."""

from typing import Any

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.compatibility_views import configure_compatibility_queries


class NativeStatements:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def execute(self, step: dict[str, Any]) -> dict[str, Any]:
        context = step["context"]
        action, table = context["action"], context["table"]
        parameters = step["parameters"]
        if isinstance(parameters, list):
            parameters = tuple(parameters)
        try:
            await configure_compatibility_queries(self.session)
            connection = await self.session.connection()
            if table == "products" and action == "delete":
                before = (
                    (await connection.exec_driver_sql(context["before_query"], parameters))
                    .mappings()
                    .all()
                )
                for row in before:
                    await self._delete_nutrition(row["id"])
            result = await connection.exec_driver_sql(step["query"], parameters)
            response: dict[str, Any] = {
                "rows": [dict(row) for row in result.mappings()] if result.returns_rows else []
            }
            if action == "insert" and result.rowcount > 0:
                response["insert_id"] = str(result.lastrowid)
            if action != "select":
                await self.session.commit()
                self.session.expire_all()
            return response
        except DBAPIError as error:
            await self.session.rollback()
            number = getattr(error.orig, "sqlite_errorcode", 1) & 255
            state = (
                "23000]: Integrity constraint violation"
                if number == 19
                else "HY000]: General error"
            )
            return {"error": f"SQLSTATE[{state}: {number} {error.orig}"}

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
