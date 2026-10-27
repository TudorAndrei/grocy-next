"""Read compatibility rows with the pinned Grocy query and SQLite rules."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.lessql import query_rows as filtered_rows


async def query_rows(
    session: AsyncSession,
    table: str,
    query_string: bytes = b"",
    columns: list[str] | None = None,
    *,
    caught: bool = False,
) -> list[dict[str, Any]]:
    return await filtered_rows(
        session, table, query_parameters(query_string), columns=columns, caught=caught
    )
